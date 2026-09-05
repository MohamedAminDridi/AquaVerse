const cron    = require('node-cron');
const logger  = require('../utils/logger');
const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Farm    = require('../models/Farm.model');
const Alert   = require('../models/Alert.model');
const weather = require('../services/weather.service');
const { emitToFarm } = require('../socket/socketServer');

// Cooldown so the same offline alert is not raised on every cron tick. An hour
// is right in production and far too long when testing — unplug a node twice in
// one hour and the second event creates no alert, so no notification either.
// ALERT_COOLDOWN_OFFLINE_MIN overrides it (set it to 1 while demonstrating).
// How long a device must be silent before it counts as offline. These CANNOT go
// below the reporting interval: the gateway heartbeats every 10 s and nodes
// report every 5 s, so a cutoff under that would mark healthy hardware offline
// between two normal messages. A gateway losing power is usually caught far
// sooner anyway — the broker's Last Will arrives within seconds.
const OFFLINE_GATEWAY_MS = (parseInt(process.env.OFFLINE_GATEWAY_SEC, 10) || 35) * 1000;
const OFFLINE_NODE_MS    = (parseInt(process.env.OFFLINE_NODE_SEC, 10) || 30) * 1000;



exports.startJobs = () => {

  // ── Every minute: mark gateways + nodes offline if silent too long ──
  // Also runs once ~5 s after boot, so the UI shows the truth immediately when
  // the backend starts with the hardware powered off (instead of stale 'online'
  // lingering until the first cron tick).
  const sweepOffline = async () => {
    const now = Date.now();

    // ── Gateways: offline if no heartbeat in 35 s ─────────────────────
    // Heartbeat is every 10 s (lightened from 3 s to unclog the gateway's TLS
    // link) → 35 s tolerates up to two lost heartbeats before declaring death.
    const gwCutoff = new Date(now - OFFLINE_GATEWAY_MS);
    // A gateway that never sent a heartbeat has `last_heartbeat: null`, which no
    // `$lt` can match, and one stuck at 'unknown' is not 'online' — either way it
    // could never transition and so never raised an alert. Match all three.
    const gwStale = {
      $or: [
        { last_heartbeat: { $lt: gwCutoff } },
        { last_heartbeat: null },
        { last_heartbeat: { $exists: false } },
      ],
    };
    const offlineGWs = await Gateway.find({
      ...gwStale,
      status: { $in: ['online', 'unknown'] },
    }).select('_id device_id farm');

    for (const gw of offlineGWs) {
      await Gateway.findByIdAndUpdate(gw._id, { status: 'offline' });
      logger.warn(`Gateway offline: ${gw.device_id}`);

      // Shared with the Last Will path so both raise it identically, with one
      // cooldown between them.
      await require('../services/deviceOffline.service').raiseGatewayOffline(gw);

      emitToFarm(gw.farm.toString(), 'gateway:status', {
        device_id: gw.device_id,
        status:    'offline',
        ts:        new Date(),
      });
    }

    // ── Nodes: offline if no last_seen in 30 s ────────────────────────
    // Deep-sleeping nodes are silent between wakes by design, so they get a
    // DYNAMIC cutoff instead of being skipped: 1.5× their full duty cycle
    // (+60 s margin). A sleeper that misses ~2 wakes is genuinely gone —
    // before this they stayed "online" forever even when powered off.
    const nodeCutoff = new Date(now - OFFLINE_NODE_MS);
    const stale = { $or: [{ last_seen: { $lt: nodeCutoff } }, { last_seen: null }, { last_seen: { $exists: false } }] };
    const offlineNodes = await Node.find({
      ...stale,
      status:    'online',
      'sleep.enabled': { $ne: true },
    }).select('_id device_id farm');

    // A node registered in the dashboard but never heard from stays at the
    // schema default 'unknown' forever (the sweep above only looks at 'online'),
    // which renders as a confusing "unknown" chip on every screen. Flip those to
    // 'offline' so the UI is honest. No alert: it was never up, so it is not an
    // incident — just a device that has not reported yet.
    const neverSeen = await Node.find({ ...stale, status: 'unknown' }).select('_id device_id');
    for (const n of neverSeen) {
      await Node.findByIdAndUpdate(n._id, { status: 'offline' });
      logger.warn(`Node never reported: ${n.device_id} → offline`);
    }

    const sleepers = await Node.find({
      status: 'online',
      'sleep.enabled': true,
    }).select('_id device_id farm last_seen sleep');
    for (const s of sleepers) {
      const cycleMs = ((s.sleep?.awakeMin || 1) + (s.sleep?.sleepMin || 15)) * 60 * 1000;
      const cutoff  = now - (cycleMs * 1.5 + 60 * 1000);
      if (!s.last_seen || s.last_seen.getTime() < cutoff) offlineNodes.push(s);
    }

    for (const node of offlineNodes) {
      // Clear pump_state too — an offline node can't vouch for a running pump,
      // and a stale 'on' would keep the UI (and the shared-pump reconciler)
      // believing the pump is still running.
      await Node.findByIdAndUpdate(node._id, { status: 'offline', pump_state: 'off' });
      logger.warn(`Node offline: ${node.device_id}`);

      // Same shared raiser as gateways, so both behave identically.
      await require('../services/deviceOffline.service').raiseNodeOffline(node);

      emitToFarm(node.farm.toString(), 'node:status', {
        device_id: node.device_id,
        status:    'offline',
        ts:        new Date(),
      });
    }
  };
  // Every 20 s (was a 1-min cron): the sweep is the BACKUP detector — the
  // gateway's MQTT Last Will handles the instant case; this catches anything
  // the will misses (e.g. broker restart) and node silences.
  // Every 5 s, not 20: the alert should follow the status change almost at once.
  // This governs the DELAY between deciding a device is offline and raising the
  // alert — not how long silence must last first, which is the cutoff below.
  setInterval(() => sweepOffline().catch((e) => logger.warn(`Sweep failed: ${e.message}`)), 5000);
  setTimeout(() => sweepOffline().catch((e) => logger.warn(`Boot sweep failed: ${e.message}`)), 5000);

  // ── Irrigation schedules: open/close valves at their window each minute ──
  cron.schedule('* * * * *', async () => {
    const Schedule = require('../models/Schedule.model');
    const { publish }  = require('../mqtt/mqttClient');
    const topics       = require('../utils/mqttTopics');
    const { reconcileFarmPump } = require('../controllers/irrigation.controller');

    const now  = new Date();
    const day  = now.getDay();                       // 0=Sun … 6=Sat (server local time)
    const mins = now.getHours() * 60 + now.getMinutes();
    const schedules = await Schedule.find({ enabled: true, days: day });

    for (const sch of schedules) {
      const [sh, sm] = String(sch.startTime || '00:00').split(':').map(Number);
      const start = sh * 60 + sm;
      const end   = start + (sch.durationMin || 0);
      const isStart = mins === start;
      const isEnd   = mins === end;
      if (!isStart && !isEnd) continue;

      const nodes = sch.node ? await Node.find({ _id: sch.node })
                  : sch.zone ? await Node.find({ farm: sch.farm, zone: sch.zone })
                  :            await Node.find({ farm: sch.farm });
      if (!nodes.length) continue;

      for (const node of nodes) {
        if (isStart) {
          publish(topics.command(node.farm.toString(), node.device_id),
            { id: node.device_id, type: 'valve_open', payload: { percent: sch.valvePercent || 100 }, ts: Date.now() });
          node.valve_state = 'open'; node.valve_pct = sch.valvePercent || 100;
        } else {
          publish(topics.command(node.farm.toString(), node.device_id),
            { id: node.device_id, type: 'valve_close', payload: {}, ts: Date.now() });
          node.valve_state = 'closed'; node.valve_pct = 0;
        }
        await node.save();
      }
      try { await reconcileFarmPump(sch.farm); } catch (e) { logger.warn(`Schedule pump reconcile failed: ${e.message}`); }
      if (isStart) { sch.lastRun = now; await sch.save().catch(() => {}); }
      logger.info(`Schedule "${sch.name || sch._id}" ${isStart ? 'opened' : 'closed'} ${nodes.length} valve(s)`);
    }
  });

  // ── Deep-sleep schedules: match each node's wake interval to its active 24h
  // band, plus the legacy daily night window. Uses deliverToNode so a command
  // for a sleeping node is queued and lands on its next wake. ──────────────────
  cron.schedule('* * * * *', async () => {
    const irr  = require('../controllers/irrigation.controller');
    const now  = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();         // server local time

    // Band schedules: always duty-cycling; awake/sleep durations vary by time.
    const banded = await Node.find({ 'sleep.enabled': true, 'sleep.bands.0': { $exists: true } });
    for (const node of banded) {
      const band = irr.currentBand(node.sleep.bands, mins);
      if (band && (band.awakeMin !== node.sleep.awakeMin || band.sleepMin !== node.sleep.sleepMin)) {
        irr.deliverToNode(node, { id: node.device_id, type: 'sleep_config', payload: { enabled: true, awake_min: band.awakeMin, sleep_min: band.sleepMin }, ts: Date.now() });
        node.sleep.awakeMin = band.awakeMin; node.sleep.sleepMin = band.sleepMin; node.sleep.state = 'sleeping';
        node.markModified('sleep'); await node.save().catch(() => {});
        logger.info(`💤 ${node.device_id} band → awake ${band.awakeMin}m / sleep ${band.sleepMin}m`);
      }
    }

    // Legacy daily night window (only for nodes without a band schedule).
    const daily = await Node.find({ 'sleep.daily': true, 'sleep.bands.0': { $exists: false } });
    for (const node of daily) {
      const s = node.sleep || {};
      const startMin = irr.hhmmToMin(s.startTime || '22:00');
      const wakeMin  = irr.hhmmToMin(s.wakeTime  || '06:00');
      if (mins === startMin && s.state !== 'sleeping') {
        irr.deliverToNode(node, { id: node.device_id, type: 'sleep_now', payload: { awake_min: s.awakeMin || 1, sleep_min: s.sleepMin || 15 }, ts: Date.now() });
        node.sleep.enabled = true; node.sleep.state = 'sleeping';
        node.markModified('sleep'); await node.save().catch(() => {});
        logger.info(`💤 ${node.device_id} daily sleep`);
      } else if (mins === wakeMin && s.state !== 'awake') {
        irr.deliverToNode(node, { id: node.device_id, type: 'wake', payload: {}, ts: Date.now() });
        node.sleep.enabled = false; node.sleep.state = 'awake';
        node.markModified('sleep'); await node.save().catch(() => {});
        logger.info(`☀️ ${node.device_id} daily wake`);
      }
    }
  });

  // ── AI autopilot: forecast every node + recommendations + closed-loop ──
  // Every 5 min (and once 8 s after boot). Always forecasts & advises; only
  // ACTUATES valves when the global Edge-AI switch is ON and a node opted into
  // ai.autoIrrigate — and even then only on trusted data, never against rain,
  // with a 20-min cooldown. Everything it does is logged as a Decision.
  const runAutopilot = async () => {
    const forecast = require('../services/forecast.service');
    const rain     = require('../services/rain.service');
    const irr      = require('../controllers/irrigation.controller');
    const Decision = require('../models/Decision.model');
    const SystemSetting = require('../models/SystemSetting.model');
    const aiDoc = await SystemSetting.findOne({ key: 'ai' });
    const aiOn  = !!aiDoc?.aiEnabled;

    const farms = await Farm.find().select('_id name location');
    for (const farm of farms) {
      const nodes = await Node.find({ farm: farm._id });
      if (!nodes.length) continue;
      const { forecasts, recommendations, weather: wx } = await forecast.runFarm(farm, nodes);

      // Rain fusion: settle any open forecast-verification window, then open a
      // new one if rain is predicted — this is what builds forecast confidence.
      rain.settle(farm._id);
      if (wx?.rainInH != null) rain.notePrediction(farm._id, wx.rainInH);
      const rainingNow = rain.isRainingNow(farm._id);
      const rainState  = rain.current(farm._id);
      if (rainState) emitToFarm(farm._id.toString(), 'rain:update', { farm: farm._id, ...rainState, confidence: rain.confidence(farm._id) });

      forecasts.forEach((f) => f.ok && emitToFarm(farm._id.toString(), 'ai:forecast', f));
      if (recommendations.length) emitToFarm(farm._id.toString(), 'ai:recommendation', { farm: farm._id, recs: recommendations });
      if (rainingNow) emitToFarm(farm._id.toString(), 'ai:recommendation', { farm: farm._id, recs: [{ level: 'info', text: '🌧 Rain detected on site — irrigation paused' }] });

      if (!aiOn) continue;                                   // advisory only when AI off
      for (const node of nodes) {
        if (!node.ai?.autoIrrigate) continue;
        const f = forecasts.find((x) => x.deviceId === node.device_id);
        if (!f || !f.ok) continue;
        const online = node.status === 'online';
        const soil = f.current;
        const target = node.ai.soilTarget ?? 35;
        const trusted = soil != null && soil > 0 && soil < 100;   // basic trust gate
        // Rain fusion decides the skip: the on-site sensor is authoritative for
        // NOW, the forecast plans ahead (and is discounted if its local
        // confidence is poor). Real falling water always beats a prediction.
        const rainFusion = rain.fuse(farm._id, wx, f.hoursToDry);
        const rainSoon = rainFusion.skipIrrigation;
        const coolOk = !node.ai.lastAuto || (Date.now() - new Date(node.ai.lastAuto).getTime() > 20 * 60 * 1000);
        const valveOpen = node.valve_state === 'open';

        let act = null;
        if (online && trusted && !valveOpen && soil <= target - 3 && !rainSoon && coolOk) act = 'open';
        else if (valveOpen && (soil >= target || rainSoon)) act = 'close';
        if (!act) continue;

        irr.deliverToNode(node, { id: node.device_id, type: act === 'open' ? 'valve_open' : 'valve_close', payload: act === 'open' ? { percent: 100 } : {}, ts: Date.now() });
        node.valve_state = act === 'open' ? 'open' : 'closed';
        node.ai.lastAuto = new Date(); node.markModified('ai');
        await node.save().catch(() => {});
        await irr.reconcileFarmPump(farm._id).catch(() => {});
        await Decision.create({
          farm: farm._id, deviceId: node.device_id,
          inputs: { soil, hoursToDry: f.hoursToDry, rainInH: f.rainInH, rainingNow: rainFusion.rainingNow },
          irrigate: act === 'open', duration_s: 0,
          why: act === 'open' ? 'autopilot: soil below target, no rain'
             : (rainSoon ? `autopilot: ${rainFusion.reason || 'rain incoming'}` : 'autopilot: target reached'),
          agree: null, modelVersion: 'autopilot-v0',
        }).catch(() => {});
        emitToFarm(farm._id.toString(), 'ai:recommendation', { farm: farm._id, recs: [{ deviceId: node.device_id, level: act === 'open' ? 'warn' : 'info', text: `🤖 Autopilot ${act === 'open' ? 'opened' : 'closed'} ${node.device_id} (soil ${soil}% / target ${target}%)` }] });
        logger.info(`🤖 Autopilot ${act} ${node.device_id} soil=${soil}% target=${target}%`);
      }
    }
  };
  cron.schedule('*/5 * * * *', () => runAutopilot().catch((e) => logger.warn(`Autopilot failed: ${e.message}`)));
  setTimeout(() => runAutopilot().catch((e) => logger.warn(`Autopilot warm-up failed: ${e.message}`)), 8000);

  // ── Live weather: fetch Open-Meteo per farm and broadcast over Socket.IO ──
  // Every 15 min (Open-Meteo updates ~hourly; 15 min keeps clients fresh while
  // staying well within the free rate limit). Plus one run ~5 s after boot.
  cron.schedule('*/15 * * * *', () => {
    weather.refreshAllFarms().catch((e) => logger.warn(`Weather refresh failed: ${e.message}`));
  });
  setTimeout(() => {
    weather.refreshAllFarms().catch((e) => logger.warn(`Weather warm-up failed: ${e.message}`));
  }, 5000);

  // ── Keep-alive self-ping (Render free tier sleeps after 15 min idle) ──
  // Every 10 min, GET our own public /api/health so the host sees inbound
  // traffic before the 15-min idle cutoff. Render sets RENDER_EXTERNAL_URL
  // automatically; KEEPALIVE_URL overrides it (or enables this elsewhere).
  // Does nothing when neither is set (local dev).
  const keepAliveBase = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (keepAliveBase) {
    const url = `${keepAliveBase.replace(/\/$/, '')}/api/health`;
    cron.schedule('*/10 * * * *', () => {
      fetch(url).catch((e) => logger.warn(`Keep-alive ping failed: ${e.message}`));
    });
    logger.info(`Keep-alive ping armed → ${url} (every 10 min)`);
  }

  // ── System heartbeat (resilience layer, Phase 1) ────────────────────
  // Every 10 s, publish a sequence-numbered beacon per farm on
  // farms/{farmId}/system/heartbeat. The gateway relays it over LoRa as a
  // binary HEARTBEAT frame; nodes that miss 3 consecutive beacons switch to
  // AUTONOMOUS mode. The beacon also carries the dashboard's edge-AI switch,
  // so flipping it reaches every node within one beacon period.
  let hbSeq = 0;
  setInterval(async () => {
    try {
      const Farm = require('../models/Farm.model');
      const SystemSetting = require('../models/SystemSetting.model');
      const { publish } = require('../mqtt/mqttClient');
      const ai = await SystemSetting.findOne({ key: 'ai' }).lean();
      const farms = await Farm.find().select('_id').lean();
      hbSeq = (hbSeq + 1) >>> 0;
      for (const f of farms) {
        publish(`farms/${f._id}/system/heartbeat`,
          { seq: hbSeq, ai: ai?.aiEnabled ? 1 : 0, ts: Date.now() }, { qos: 0 });
      }
    } catch (e) { logger.warn(`Heartbeat publish failed: ${e.message}`); }
  }, 10000);

  // ── Daily summary log ──────────────────────────────────────────────
  cron.schedule('0 0 * * *', () => {
    logger.info('Daily cron: system summary logged');
  });

  logger.info('Cron jobs started');
};
