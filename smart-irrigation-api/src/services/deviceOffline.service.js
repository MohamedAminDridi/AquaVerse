const Alert  = require('../models/Alert.model');
const logger = require('../utils/logger');
const { emitToFarm } = require('../socket/socketServer');

// ─────────────────────────────────────────────────────────────────────────────
// "This device went offline" — raised from TWO places, which is exactly why it
// lives here.
//
// A gateway can be discovered offline two ways:
//   • its MQTT Last Will arrives within seconds of a power cut  (fast)
//   • the heartbeat sweep notices silence after 35 s            (slow)
//
// The fast path used to only flip the status and say nothing, and the slow path
// only alerted on an online→offline transition — so by the time the sweep ran,
// the status was already 'offline' and no alert was ever created. Both paths now
// call this, and the cooldown stops them raising it twice.
// ─────────────────────────────────────────────────────────────────────────────

const COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_OFFLINE_MIN, 10) || 60) * 60 * 1000;

/**
 * @param {object} o
 * @param {ObjectId} o.farm      farm the device belongs to
 * @param {ObjectId} [o.gateway] set for a gateway
 * @param {ObjectId} [o.node]    set for a node
 * @param {string} o.deviceId    human-readable id for the message
 * @param {string} o.kind        'Gateway' | 'Node'
 * @returns {Promise<object|null>} the alert, or null if one is already open
 */
async function raiseOffline({ farm, gateway, node, deviceId, kind }) {
  if (!farm) return null;

  const scope = gateway ? { gateway } : node ? { node } : {};
  const exists = await Alert.exists({
    ...scope,
    farm,
    type:         'device_offline',
    acknowledged: false,
    createdAt:    { $gt: new Date(Date.now() - COOLDOWN_MS) },
  });
  if (exists) {
    logger.debug(`Offline alert for ${deviceId} suppressed — one is already open`);
    return null;
  }

  const alert = await Alert.create({
    farm,
    ...scope,
    type:     'device_offline',
    severity: 'critical',
    message:  `${kind} "${deviceId}" went offline`,
  });

  emitToFarm(String(farm), 'alert:new', alert.toObject());
  logger.warn(`🚨 Alert: ${kind} ${deviceId} offline`);
  return alert;
}

/**
 * Close the open offline alert when a device comes back.
 *
 * This is what makes a SECOND outage report. The cooldown asks "is an
 * unacknowledged offline alert already open for this device" — which is right
 * while the device stays down, but wrong once it has recovered: the old alert
 * kept suppressing every later outage, so the device could go offline again and
 * again in silence. Resolving on recovery means the next failure is a new event,
 * and the alert list stops accumulating outages that are long over.
 */
async function resolveOffline({ farm, gateway, node, deviceId }) {
  const scope = gateway ? { gateway } : node ? { node } : null;
  if (!scope || !farm) return 0;

  const r = await Alert.updateMany(
    { ...scope, farm, type: 'device_offline', acknowledged: false },
    {
      acknowledged: true,
      acknowledged_at: new Date(),
      acknowledged_note: 'Resolved automatically — device came back online',
    },
  );
  const n = r.modifiedCount || 0;
  if (n) logger.info(`Resolved ${n} open offline alert(s) for ${deviceId}`);
  return n;
}

exports.resolveOffline = resolveOffline;
exports.raiseOffline = raiseOffline;
exports.raiseGatewayOffline = (gw) => raiseOffline({
  farm: gw.farm, gateway: gw._id, deviceId: gw.device_id, kind: 'Gateway',
});
exports.raiseNodeOffline = (n) => raiseOffline({
  farm: n.farm, node: n._id, deviceId: n.device_id, kind: 'Node',
});

exports.resolveGatewayOffline = (gw) => resolveOffline({
  farm: gw.farm, gateway: gw._id, deviceId: gw.device_id,
});
exports.resolveNodeOffline = (n) => resolveOffline({
  farm: n.farm, node: n._id, deviceId: n.device_id,
});

/**
 * A gateway coming back. Sent as a notification only — deliberately NOT written
 * to the alert list: "it is working again" is not a problem to triage, and a
 * recovery row for every reconnect would bury the real alerts.
 *
 * Gateways only. A node blinking in and out is normal (deep sleep), so the same
 * treatment there would be constant noise.
 */
// A gateway that keeps dropping and reconnecting would otherwise fire a notice
// every few seconds. One per gateway per window is enough to tell you it is back.
const ONLINE_NOTICE_GAP_MS = (parseInt(process.env.ONLINE_NOTICE_GAP_SEC, 10) || 30) * 1000;
const lastOnlineNotice = new Map();

async function notifyOnline({ farm, gateway, node, deviceId, kind }) {
  try {
    const key = String(gateway || node);
    const now = Date.now();
    if (now - (lastOnlineNotice.get(key) || 0) < ONLINE_NOTICE_GAP_MS) return;
    lastOnlineNotice.set(key, now);

    const push = require('./push.service');
    if (!push.enabled()) return;
    await push.sendAlert({
      _id: '', farm, severity: 'info', type: 'device_online',
      ...(gateway ? { gateway } : { node }),
      message: `${kind} "${deviceId}" is back online`,
    });
    logger.info(`🔆 Recovery notice sent: ${kind.toLowerCase()} ${deviceId} online`);
  } catch (e) {
    logger.warn(`${kind} online notice failed: ${e.message}`);
  }
}

/** Recovery: resolve the open alert, then say so. Both device kinds. */
exports.notifyGatewayOnline = async (gw) => {
  await resolveOffline({ farm: gw.farm, gateway: gw._id, deviceId: gw.device_id }).catch(() => {});
  return notifyOnline({ farm: gw.farm, gateway: gw._id, deviceId: gw.device_id, kind: 'Gateway' });
};

exports.notifyNodeOnline = async (n) => {
  await resolveOffline({ farm: n.farm, node: n._id, deviceId: n.device_id }).catch(() => {});
  return notifyOnline({ farm: n.farm, node: n._id, deviceId: n.device_id, kind: 'Node' });
};
