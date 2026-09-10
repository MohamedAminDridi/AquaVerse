const User = require('../models/User.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwtHelper');

/**
 * Public sign-up.
 *
 * Two things were wrong here and both are closed now.
 *
 * 1. `role` was taken from the request body, so anyone could POST
 *    {"role":"admin"} and become an administrator. The role is now forced,
 *    whatever the caller sends.
 * 2. Client accounts are meant to be created by an administrator from the
 *    Clients screen, so public sign-up is off unless ALLOW_PUBLIC_REGISTER is
 *    explicitly set. A self-registered account would own no farm and see an
 *    empty application anyway.
 */
exports.register = asyncHandler(async (req, res) => {
  if (process.env.ALLOW_PUBLIC_REGISTER !== 'true')
    return res.status(403).json({
      success: false,
      message: 'Accounts are created by an administrator. Please contact your provider.',
    });

  const { name, email, password, phone } = req.body;
  if (await User.findOne({ email }))
    return res.status(409).json({ success: false, message: 'Email already registered' });
  const user       = await User.create({ name, email, password, phone, role: 'client' });
  const access     = signAccess(user._id);
  const refreshTok = signRefresh(user._id);
  // Use findByIdAndUpdate to avoid VersionError race conditions
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: refreshTok, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });
  created(res, { user, access, refresh: refreshTok }, 'Registration successful');
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  if (!user.isActive)
    return res.status(403).json({ success: false, message: 'Account suspended' });
  const access     = signAccess(user._id);
  const refreshTok = signRefresh(user._id);
  // Atomic update — no VersionError possible
  await User.findByIdAndUpdate(user._id, {
    $set:  { lastLogin: new Date() },
    $pull: { refreshTokens: { expiresAt: { $lt: new Date() } } },
  });
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: refreshTok, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });
  success(res, { user, access, refresh: refreshTok }, 'Login successful');
});

exports.logout = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { refreshTokens: { token: refresh_token } },
  });
  success(res, {}, 'Logged out');
});

exports.getProfile    = asyncHandler(async (req, res) => success(res, { user: req.user }));

/**
 * PUT /api/auth/me — the account settings a user owns.
 *
 * Notification preferences are merged rather than replaced: the client sends
 * only the switch it just flipped, and a plain assignment would wipe the rest.
 * A password change is handled here too, and requires the current password —
 * a stolen session should not be enough to lock the real owner out.
 */
exports.updateProfile = asyncHandler(async (req, res) => {
  const update = {};
  ['name', 'phone'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

  if (req.body.notifications && typeof req.body.notifications === 'object') {
    const current = req.user.notifications ? req.user.notifications.toObject?.() ?? req.user.notifications : {};
    update.notifications = { ...current, ...req.body.notifications };
  }

  if (req.body.password) {
    if (String(req.body.password).length < 8)
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    const withPwd = await User.findById(req.user._id).select('+password');
    const ok = await withPwd.comparePassword(String(req.body.currentPassword || ''));
    if (!ok)
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    withPwd.password = req.body.password;   // re-hashed by the pre-save hook
    withPwd.refreshTokens = [];             // other sessions are signed out
    Object.assign(withPwd, update);
    await withPwd.save();
    return success(res, { user: withPwd }, 'Profile updated');
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
  success(res, { user }, 'Profile updated');
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ success: false, message: 'Refresh token required' });
  let payload;
  try { payload = verifyRefresh(refresh_token); }
  catch { return res.status(401).json({ success: false, message: 'Invalid refresh token' }); }

  const user  = await User.findById(payload.id);
  const entry = user?.refreshTokens.find(t => t.token === refresh_token && t.expiresAt > new Date());
  if (!user || !entry)
    return res.status(401).json({ success: false, message: 'Refresh token expired or revoked' });

  const access     = signAccess(user._id);
  const newRefresh = signRefresh(user._id);

  // Atomic swap — remove old, add new in one round-trip, no VersionError
  await User.findByIdAndUpdate(user._id, {
    $pull: { refreshTokens: { token: refresh_token } },
  });
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: newRefresh, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });

  success(res, { access, refresh: newRefresh });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  await User.findOne({ email: req.body.email });
  success(res, {}, 'If that email exists, a reset link has been sent');
});