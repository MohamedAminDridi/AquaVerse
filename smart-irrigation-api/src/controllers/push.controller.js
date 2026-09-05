const PushToken = require('../models/PushToken.model');
const push      = require('../services/push.service');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');

// Register (or refresh) this device's FCM token. Upsert on the token itself:
// the OS reissues tokens, and the same device must never occupy two rows.
exports.register = asyncHandler(async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'token is required' });
  await PushToken.findOneAndUpdate(
    { token },
    { token, user: req.user?._id, platform: platform || 'android', last_seen: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  success(res, { enabled: push.enabled() }, 'Device registered for alerts');
});

// Called on sign-out so a shared phone stops receiving another account's alerts.
exports.unregister = asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (token) await PushToken.deleteOne({ token });
  success(res, {}, 'Device unregistered');
});

// Lets the app tell the user whether the server can actually deliver anything.
exports.status = asyncHandler(async (req, res) => {
  success(res, {
    enabled: push.enabled(),
    devices: await PushToken.countDocuments(),
    ...push.stats(),      // alerts, lastAlert, lastSend — the whole chain at a glance
  });
});

// A one-tap end-to-end check. "No notifications" can mean the server has no
// credentials, no device ever registered, or FCM rejected the token — each
// needs a different fix, and this reports which.
exports.test = asyncHandler(async (req, res) => {
  const devices = await PushToken.countDocuments();
  if (!push.enabled()) {
    return success(res, { enabled: false, devices, sent: 0 },
      'Server has no Firebase credentials — notifications cannot be sent');
  }
  if (!devices) {
    return success(res, { enabled: true, devices: 0, sent: 0 },
      'No device is registered — open the app and allow notifications');
  }
  // Android will not show a notification-payload message while the app is in
  // the FOREGROUND — it hands it to the app instead and the tray stays empty.
  // So the test is delayed, giving you time to close the app, which is also the
  // condition actually being tested.
  const delay = Math.min(30, Math.max(0, parseInt(req.body?.delaySec, 10) || 0));
  const payload = {
    _id: 'test', farm: '', severity: 'warning', type: 'test',
    message: 'Test notification from AquaVerse — notifications are working.',
  };

  if (delay > 0) {
    setTimeout(() => { push.sendAlert(payload).catch(() => {}); }, delay * 1000);
    return success(res, { enabled: true, devices, scheduled: delay },
      `Close the app now — the test arrives in ${delay} seconds`);
  }

  const r = await push.sendAlert(payload);
  success(res, { enabled: true, devices, sent: r.sent || 0, error: r.error },
    r.sent ? `Sent to ${r.sent} of ${devices} device(s)` : `Delivered to 0 devices${r.error ? ': ' + r.error : ''}`);
});
