const admin  = require('firebase-admin');
const logger = require('../utils/logger');
const PushToken = require('../models/PushToken.model');

// ─────────────────────────────────────────────────────────────────────────────
// Push notifications, via Firebase Cloud Messaging.
//
// FCM is the only mechanism that reaches an Android device when the app process
// is not running: the message goes to Google's servers, which wake the device
// and hand it to the system tray. A socket, a poll or a background timer all die
// with the process, so none of them can do this.
//
// The whole module is OPTIONAL. Without credentials it logs once and every send
// becomes a no-op, so the API runs exactly as before on a machine with no
// Firebase set up.
// ─────────────────────────────────────────────────────────────────────────────

let ready = null;   // null = untried, false = unavailable, true = initialised

function init() {
  if (ready !== null) return ready;

  const raw  = process.env.FIREBASE_SERVICE_ACCOUNT;       // inline JSON
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;  // or a file
  let cred = null;
  try {
    if (raw)       cred = JSON.parse(raw);
    else if (path) cred = require(require('path').resolve(path));
  } catch (e) {
    logger.warn(`Push: service account could not be read (${e.message}) — notifications disabled`);
    ready = false;
    return ready;
  }

  if (!cred) {
    logger.info('Push: FIREBASE_SERVICE_ACCOUNT not set — notifications disabled');
    ready = false;
    return ready;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    }
    ready = true;
    logger.info('Push: Firebase ready — alert notifications enabled');
  } catch (e) {
    logger.error(`Push: Firebase init failed — ${e.message}`);
    ready = false;
  }
  return ready;
}

exports.enabled = () => init() === true;

// A running record of the last attempt. "No notification" is otherwise
// invisible from the phone: this makes it answerable without server logs.
const stats = { alerts: 0, lastAlert: null, lastSend: null };
exports.noteAlert = (doc) => {
  stats.alerts += 1;
  stats.lastAlert = { at: new Date(), type: doc?.type, severity: doc?.severity };
};
exports.stats = () => stats;

/** Wording that reads well in a system tray, where there is no context. */
function compose(alert) {
  const sev = alert.severity === 'critical' ? '🚨'
            : alert.severity === 'warning'  ? '⚠️' : 'ℹ️';
  const kind = alert.gateway ? 'Gateway' : alert.node ? 'Node' : 'Farm';
  const type = alert.type === 'device_offline' ? 'offline'
             : alert.type === 'device_online'  ? 'back online'
             : alert.type === 'low_battery'    ? 'low battery'
             : alert.type === 'threshold_breach' ? 'threshold'
             : (alert.type || 'alert');
  // A recovery is good news; the warning triangle would misrepresent it.
  const icon = alert.type === 'device_online' ? '✅' : sev;
  return {
    title: `${icon} ${kind} ${type}`,
    body:  String(alert.message || 'An alert was raised').slice(0, 240),
  };
}

/**
 * Deliver one alert to every registered device. Tokens FCM reports as dead are
 * deleted, so the list does not rot into a pile of invalid ids.
 */

/**
 * Les jetons autorisés à recevoir une alerte de cette exploitation.
 *
 * Une alerte sans exploitation rattachée (incident système) ne part qu'aux
 * administrateurs : elle ne concerne aucun client en particulier.
 */
async function tokensForFarm(farmId) {
  const User = require('../models/User.model');
  const Farm = require('../models/Farm.model');

  const admins = await User.find({ role: 'admin', isActive: true }).distinct('_id');
  let recipients = admins;

  if (farmId) {
    const farm = await Farm.findById(farmId).select('owner members.user').lean();
    if (farm) {
      const ids = [farm.owner, ...(farm.members || []).map((m) => m.user)].filter(Boolean);
      recipients = [...admins, ...ids];
    }
  }

  const uniq = [...new Set(recipients.map(String))];
  const rows = await PushToken.find({ user: { $in: uniq } }).select('token').lean();
  return rows.map((t) => t.token);
}

exports.sendAlert = async (alert) => {
  if (!init()) return { sent: 0, skipped: true };

  // Ciblage par exploitation.
  //
  // Sans ce filtre, chaque terminal enregistré recevait CHAQUE alerte de la
  // plateforme : un client était réveillé la nuit par la passerelle d'un autre.
  // Les destinataires sont donc les personnes qui ont réellement accès à
  // l'exploitation concernée — propriétaire, membres, et les administrateurs,
  // qui supervisent l'ensemble du parc.
  const tokens = await tokensForFarm(alert.farm);
  if (!tokens.length) {
    stats.lastSend = { at: new Date(), title: 'skipped', sent: 0, of: 0, error: 'no registered devices' };
    return { sent: 0, skipped: true };
  }

  const { title, body } = compose(alert);
  const message = {
    notification: { title, body },
    // Data travels with the message so a tap can open the exact alert.
    data: {
      alertId:  String(alert._id || ''),
      farmId:   String(alert.farm || ''),
      severity: String(alert.severity || 'warning'),
      type:     String(alert.type || ''),
    },
    android: {
      priority: alert.severity === 'critical' ? 'high' : 'normal',
      notification: {
        channelId: 'aquaverse-alerts',
        sound: 'default',
        color: alert.severity === 'critical' ? '#f87171' : '#22d3ee',
      },
    },
  };

  try {
    const res = await admin.messaging().sendEachForMulticast({ ...message, tokens });
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code || '';
      if (!r.success && (code.includes('registration-token-not-registered')
                      || code.includes('invalid-argument'))) {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await PushToken.deleteMany({ token: { $in: dead } });
      logger.info(`Push: pruned ${dead.length} dead token(s)`);
    }
    logger.info(`Push: "${title}" → ${res.successCount}/${tokens.length} device(s)`);
    stats.lastSend = { at: new Date(), title, sent: res.successCount, of: tokens.length };
    return { sent: res.successCount };
  } catch (e) {
    logger.error(`Push: send failed — ${e.message}`);
    stats.lastSend = { at: new Date(), title, sent: 0, of: tokens.length, error: e.message };
    return { sent: 0, error: e.message };
  }
};
