const router   = require('express').Router();
const User     = require('../models/User.model');
const Farm     = require('../models/Farm.model');
const Node     = require('../models/Node.model');
const Gateway  = require('../models/Gateway.model');
const { protect, authorize } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

// All admin routes require login + admin role
router.use(protect, authorize('admin'));

/* GET /api/admin/users — list all users */
router.get('/users', asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (role)   filter.role  = role;
  if (search) filter.$or   = [
    { name:  { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
  ];
  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(+limit);

  // How many farms each one owns — the Clients screen shows it per row, and
  // fetching it per user from the client would be one request each.
  const owned = await Farm.aggregate([
    { $group: { _id: '$owner', farms: { $sum: 1 } } },
  ]);
  const farmCount = Object.fromEntries(owned.map((o) => [String(o._id), o.farms]));
  const rows = users.map((u) => ({ ...u.toJSON(), farmCount: farmCount[String(u._id)] || 0 }));

  success(res, { users: rows, total, page: +page, limit: +limit });
}));

/**
 * POST /api/admin/users — create a client account.
 *
 * This is the only way a client account comes into existence: public
 * self-registration creates nothing that can see data, because a fresh account
 * owns no farm and the scoping helper therefore returns an empty set. Handing
 * the client a farm is what actually grants access, so it happens here, in the
 * same operation, rather than being a second step an admin can forget.
 */
router.post('/users', asyncHandler(async (req, res) => {
  const { name, email, password, phone = null, role = 'client', farmName } = req.body || {};

  if (!name || !email || !password)
    return res.status(400).json({ success: false, message: 'name, email and password are required' });
  if (String(password).length < 8)
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  if (!['client', 'farmer', 'viewer', 'technician', 'admin'].includes(role))
    return res.status(400).json({ success: false, message: 'Unknown role' });

  const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (exists) return res.status(409).json({ success: false, message: 'That email is already registered' });

  const user = await User.create({
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password,                       // hashed by the model's pre-save hook
    phone,
    role,
  });

  // Optional starter farm, owned by the new client.
  let farm = null;
  if (farmName && String(farmName).trim()) {
    farm = await Farm.create({ name: String(farmName).trim(), owner: user._id });
  }

  created(res, { user, farm }, farm ? 'Client and farm created' : 'Client created');
}));

/* GET /api/admin/users/:id — single user, with the farms they can reach */
router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const farms = await Farm.find({
    $or: [{ owner: user._id }, { 'members.user': user._id }],
  }).select('name crop_type size_ha owner isActive').lean();

  const farmIds = farms.map((f) => f._id);
  const [nodes, gateways] = await Promise.all([
    Node.countDocuments({ farm: { $in: farmIds } }),
    Gateway.countDocuments({ farm: { $in: farmIds } }),
  ]);

  success(res, { user, farms, counts: { farms: farms.length, nodes, gateways } });
}));

/* PATCH /api/admin/users/:id — update role, suspend, or reset the password */
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const allowed = ['role', 'isActive', 'name', 'phone'];
  const update  = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

  // Refuse to lock the platform out of itself: the last active admin cannot be
  // demoted or suspended, because nobody would be left to undo it.
  if (update.role !== undefined || update.isActive === false) {
    const target = await User.findById(req.params.id).select('role isActive');
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    const losingAdmin = target.role === 'admin'
      && (update.role !== undefined && update.role !== 'admin' || update.isActive === false);
    if (losingAdmin) {
      const admins = await User.countDocuments({ role: 'admin', isActive: true });
      if (admins <= 1)
        return res.status(400).json({ success: false, message: 'This is the last active admin' });
    }
  }

  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  success(res, { user }, 'User updated');
}));

/* PUT /api/admin/users/:id/password — set a new password for a client */
router.put('/users/:id/password', asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8)
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  const user = await User.findById(req.params.id).select('+password');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.password = password;          // re-hashed by the pre-save hook
  user.refreshTokens = [];           // existing sessions are invalidated
  await user.save();
  success(res, {}, 'Password updated');
}));

/* POST /api/admin/users/:id/farms — create a farm owned by this client */
router.post('/users/:id/farms', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const { name, crop_type, size_ha } = req.body || {};
  if (!name || !String(name).trim())
    return res.status(400).json({ success: false, message: 'Farm name is required' });
  const farm = await Farm.create({
    name: String(name).trim(), owner: user._id, crop_type, size_ha,
  });
  created(res, { farm }, 'Farm created for client');
}));

/* POST /api/admin/farms/:farmId/transfer — hand a farm over to another client */
router.post('/farms/:farmId/transfer', asyncHandler(async (req, res) => {
  const { userId } = req.body || {};
  const [farm, user] = await Promise.all([
    Farm.findById(req.params.farmId),
    User.findById(userId),
  ]);
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  farm.owner = user._id;
  // The previous owner would otherwise linger as a member and keep access.
  farm.members = (farm.members || []).filter((m) => !m.user.equals(user._id));
  await farm.save();
  success(res, { farm }, 'Farm transferred');
}));

/* DELETE /api/admin/users/:id — delete user */
router.delete('/users/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString())
    return res.status(400).json({ success: false, message: 'Cannot delete your own account' });

  // A farm with no owner is unreachable by anyone, so refuse rather than
  // silently orphaning it. The admin transfers or deletes the farms first.
  const owned = await Farm.countDocuments({ owner: req.params.id });
  if (owned > 0)
    return res.status(409).json({
      success: false,
      message: `This client still owns ${owned} farm(s). Transfer or delete them first.`,
    });

  await User.findByIdAndDelete(req.params.id);
  res.status(204).send();
}));

module.exports = router;
