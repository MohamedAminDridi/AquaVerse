const mqtt      = require('mqtt');
const logger    = require('../utils/logger');
const handleTelemetry = require('./telemetryHandler');
const { emitToFarm }  = require('../socket/socketServer');

// ─────────────────────────────────────────────────────────────────────────────
// Dual-broker MQTT: a LOCAL broker (always on) and an optional CLOUD broker that
// can be toggled at runtime from the AquaVerse Settings UI. Both feed the SAME
// message handler, and publish() goes to every connected broker, so the gateway
// can sit on either one. The cloud on/off choice is persisted (SystemSetting).
// ─────────────────────────────────────────────────────────────────────────────
const SUBS = [
  'farms/+/nodes/+/telemetry',
  'farms/+/nodes/+/status',
  'farms/+/nodes/+/alerts',
  'farms/+/gateways/+/heartbeat',
];

const clients = {};        // name -> { client, connected, url }
let cloudEnabled = false;  // mirror of the persisted flag

// Hide credentials when echoing a broker URL back to the UI.
function maskUrl(url) {
  try { return String(url).replace(/\/\/[^@]*@/, '//'); } catch { return null; }
}

function makeOpts(name) {
  const o = {
    clientId:        `aquaverse-${name}-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout:  10000,
    keepalive:       60,
  };
  if (name === 'cloud') {
    if (process.env.MQTT_CLOUD_USERNAME) o.username = process.env.MQTT_CLOUD_USERNAME;
    if (process.env.MQTT_CLOUD_PASSWORD) o.password = process.env.MQTT_CLOUD_PASSWORD;
  } else {
    if (process.env.MQTT_USERNAME) o.username = process.env.MQTT_USERNAME;
    if (process.env.MQTT_PASSWORD) o.password = process.env.MQTT_PASSWORD;
  }
  return o;
}

function connectBroker(name, url) {
  if (!url) { logger.warn(`MQTT(${name}): no URL configured — skipped`); return; }
  if (clients[name]) return;   // already connected/connecting

  const client = mqtt.connect(url, makeOpts(name));
  clients[name] = { client, connected: false, url };

  client.on('connect', () => {
    clients[name].connected = true;
    logger.info(`✅ MQTT(${name}) connected → ${maskUrl(url)}`);
    client.subscribe(SUBS, { qos: 1 }, (err, granted) => {
      if (err) logger.error(`MQTT(${name}) subscribe error: ${err.message}`);
      else (granted || []).forEach(g => logger.info(`  📡 (${name}) ${g.topic}`));
    });
  });

  client.on('message', handleMessage);
  client.on('error',     e  => logger.error(`MQTT(${name}) error: ${e.message}`));
  client.on('offline',   () => { if (clients[name]) clients[name].connected = false; logger.warn(`MQTT(${name}) offline`); });
  client.on('close',     () => { if (clients[name]) clients[name].connected = false; });
  client.on('reconnect', () => logger.info(`MQTT(${name}) reconnecting…`));
}

function disconnectBroker(name) {
  if (!clients[name]) return;
  try { clients[name].client.end(true); } catch { /* ignore */ }
  delete clients[name];
  logger.info(`🔌 MQTT(${name}) disconnected`);
}

// Shared message handler for every broker.
async function handleMessage(topic, buffer) {
  let payload;
  try { payload = JSON.parse(buffer.toString()); }
  catch { logger.warn(`Invalid JSON on ${topic}`); return; }

  const parts    = topic.split('/');
  const farmId   = parts[1];
  const category = parts[2];
  const deviceId = parts[3];
  const msgType  = parts[4];
  if (!farmId || !category || !deviceId || !msgType) return;

  try {
    if (category === 'nodes' && msgType === 'telemetry') {
      await handleTelemetry(farmId, deviceId, payload);

    } else if (category === 'nodes' && msgType === 'status') {
      const Node = require('../models/Node.model');

      // alive packets have type='alive' but no status field
      const statusVal = payload.status
        ?? (payload.type === 'alive' || payload.online === true ? 'online' : 'unknown');

      // Accept both naming conventions from the node firmware
      const valveState = payload.valve_state ?? payload.valve ?? null;
      const pumpState  = payload.pump_state  ?? payload.pump  ?? null;
      const valvePct   = payload.valve_pct   ?? null;

      await Node.findOneAndUpdate(
        { device_id: deviceId },
        {
          $set: {
            status:    statusVal,
            last_seen: new Date(),
            ...(valveState != null ? { valve_state: valveState } : {}),
            ...(valvePct   != null ? { valve_pct:   valvePct   } : {}),
            ...(pumpState  != null ? { pump_state:  pumpState  } : {}),
            ...(payload.fw         ? { firmware_version: payload.fw } : {}),
          },
        }
      );

      emitToFarm(farmId, 'node:status', {
        device_id: deviceId,
        status:    statusVal,
        valve:     valveState,
        valve_pct: valvePct,
        pump:      pumpState,
        fw:        payload.fw ?? null,
        ts:        new Date(),
        ...payload,
      });

    } else if (category === 'nodes' && msgType === 'alerts') {
      emitToFarm(farmId, 'alert:new', { device_id: deviceId, ...payload });

    } else if (category === 'gateways' && msgType === 'heartbeat') {
      await handleGatewayHeartbeat(farmId, deviceId, payload);
    }
  } catch (e) {
    logger.error(`MQTT handler [${topic}]: ${e.message}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
const initMQTT = () => {
  // Local broker is always on (dev + the gateway when on the same LAN).
  connectBroker('local', process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883');

  // Cloud broker: connect now only if it was left ON before the last restart.
  loadCloudFlag().then((on) => {
    cloudEnabled = on;
    if (on) connectBroker('cloud', process.env.MQTT_CLOUD_URL);
  });
};

async function loadCloudFlag() {
  try {
    const SystemSetting = require('../models/SystemSetting.model');
    const doc = await SystemSetting.findOne({ key: 'broker' });
    if (doc) return !!doc.cloudEnabled;
  } catch (e) { logger.warn(`broker flag load failed: ${e.message}`); }
  return process.env.MQTT_CLOUD_DEFAULT === 'true';
}

// Toggle the cloud broker at runtime (from the Settings UI) and persist it.
async function setCloudEnabled(on) {
  cloudEnabled = !!on;
  if (cloudEnabled) connectBroker('cloud', process.env.MQTT_CLOUD_URL);
  else              disconnectBroker('cloud');
  try {
    const SystemSetting = require('../models/SystemSetting.model');
    await SystemSetting.findOneAndUpdate(
      { key: 'broker' }, { cloudEnabled }, { upsert: true, new: true });
  } catch (e) { logger.warn(`broker flag persist failed: ${e.message}`); }
  return brokerStatus();
}

function brokerStatus() {
  return {
    local: {
      url:       maskUrl(clients.local?.url || process.env.MQTT_BROKER_URL || null),
      connected: !!clients.local?.connected,
    },
    cloud: {
      configured: !!process.env.MQTT_CLOUD_URL,   // is a cloud URL set in env?
      enabled:    cloudEnabled,                    // toggle state
      connected:  !!clients.cloud?.connected,      // live link up?
      url:        process.env.MQTT_CLOUD_URL ? maskUrl(process.env.MQTT_CLOUD_URL) : null,
    },
  };
}

// Publish to EVERY connected broker so the command reaches the gateway wherever
// it is. The other broker simply has no subscriber for it — harmless.
const publish = (topic, payload, opts = { qos: 1 }) => {
  const msg = JSON.stringify(payload);
  let sent = false;
  for (const name of Object.keys(clients)) {
    if (clients[name].connected) { clients[name].client.publish(topic, msg, opts); sent = true; }
  }
  if (sent) logger.info(`📤 MQTT publish → ${topic}`);
  else      logger.warn(`MQTT not connected — dropped: ${topic}`);
  return sent;
};

const isConnected = () => Object.values(clients).some(c => c.connected);

async function handleGatewayHeartbeat(farmId, deviceId, payload) {
  const Gateway = require('../models/Gateway.model');

  const rssi     = payload.wifi_rssi ?? payload.rssi   ?? null;
  const uptime_s = payload.uptime_s  ?? payload.uptime ?? null;
  const ip       = payload.ip ?? null;

  const existing = await Gateway.findOne({ device_id: deviceId });
  if (!existing) {
    logger.warn(`Gateway "${deviceId}" not in DB — ignoring heartbeat`);
    return;
  }

  const gw = await Gateway.findOneAndUpdate(
    { device_id: deviceId },
    {
      $set: {
        status:         'online',
        last_heartbeat: new Date(),
        ip,
        ...(payload.fw ? { firmware_version: payload.fw } : {}),
      },
      $push: {
        heartbeat_log: { $each: [{ receivedAt: new Date(), ip, rssi, uptime_s }], $slice: -100 },
      },
    },
    { new: true }
  );

  emitToFarm(farmId, 'gateway:status', {
    device_id: deviceId,
    status:    'online',
    ip, rssi, uptime_s,
    fw:        payload.fw ?? null,
    pkts_ok:   payload.pkts_ok ?? null,
    ts:        new Date(),
  });
  // debug: fires every heartbeat (~3 s/gateway) — hidden in production logs
  logger.debug(`💓 GW [${deviceId}] ip=${ip} uptime=${uptime_s}s rssi=${rssi}`);
}

module.exports = { initMQTT, publish, isConnected, setCloudEnabled, brokerStatus };
