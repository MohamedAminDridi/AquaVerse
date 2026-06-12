const cron    = require('node-cron');
const logger  = require('../utils/logger');
const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Alert   = require('../models/Alert.model');
const weather = require('../services/weather.service');
const { emitToFarm } = require('../socket/socketServer');

// 1-hour cooldown: don't spam the same offline alert every cron tick
async function offlineAlertExists(query) {
  return Alert.exists({
    ...query,
    type:         'device_offline',
    acknowledged: false,
    createdAt:    { $gt: new Date(Date.now() - 60 * 60 * 1000) },
  });
}

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
    const gwCutoff = new Date(now - 35 * 1000);
    const offlineGWs = await Gateway.find({
      last_heartbeat: { $lt: gwCutoff },
      status: 'online',
    }).select('_id device_id farm');

    for (const gw of offlineGWs) {
      await Gateway.findByIdAndUpdate(gw._id, { status: 'offline' });
      logger.warn(`Gateway offline: ${gw.device_id}`);

      // Create alert once per hour max
      const exists = await offlineAlertExists({ farm: gw.farm });
      if (!exists) {
        const alert = await Alert.create({
          farm:     gw.farm,
          type:     'device_offline',
          severity: 'critical',
          message:  `Gateway "${gw.device_id}" went offline`,
        });
        emitToFarm(gw.farm.toString(), 'alert:new', alert.toObject());
        logger.warn(`🚨 Alert created: gateway ${gw.device_id} offline`);
      }

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
    const nodeCutoff = new Date(now - 30 * 1000);
    const offlineNodes = await Node.find({
      last_seen: { $lt: nodeCutoff },
      status:    'online',
      'sleep.enabled': { $ne: true },
    }).select('_id device_id farm');

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

      const exists = await offlineAlertExists({ farm: node.farm, node: node._id });
      if (!exists) {
        const alert = await Alert.create({
          farm:     node.farm,
          node:     node._id,
          type:     'device_offline',
          severity: 'critical',
          message:  `Node "${node.device_id}" went offline`,
        });
        emitToFarm(node.farm.toString(), 'alert:new', alert.toObject());
        logger.warn(`🚨 Alert created: node ${node.device_id} offline`);
      }

      emitToFarm(node.farm.toString(), 'node:status', {
        device_id: node.device_id,
        status:    'offline',
        ts:        new Date(),
      });
    }
  };
  cron.schedule('* * * * *', sweepOffline);
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

  // ── Daily summary log ──────────────────────────────────────────────
  cron.schedule('0 0 * * *', () => {
    logger.info('Daily cron: system summary logged');
  });

  logger.info('Cron jobs started');
};
