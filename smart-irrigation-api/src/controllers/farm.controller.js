const Farm          = require('../models/Farm.model');
const User          = require('../models/User.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created, paginated } = require('../utils/apiResponse');
const { accessLevelFor } = require('../utils/scope');
const del = require('../services/deletion.service');

/* GET /api/farms */
exports.listFarms = asyncHandler(async (req, res) => {
  // An administrator supervises the whole fleet, including farms they neither
  // own nor were invited to — otherwise the Clients screen could not offer a
  // farm to share in the first place.
  const filter = req.user.role === 'admin'
    ? {}
    : { $or: [{ owner: req.user._id }, { 'members.user': req.user._id }] };
  const farms = await Farm.find(filter)
    .populate('owner', 'name email')
    .populate('members.user', 'name email')
    .sort('name');
  success(res, { farms });
});

/* POST /api/farms */
exports.createFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.create({ ...req.body, owner: req.user._id });
  created(res, { farm }, 'Farm created');
});

/* GET /api/farms/:farmId */
exports.getFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId)
    .populate('owner', 'name email')
    .populate('members.user', 'name email role');
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  success(res, { farm });
});

/* PUT /api/farms/:farmId */
exports.updateFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.findByIdAndUpdate(req.params.farmId, req.body, { new: true, runValidators: true });
  success(res, { farm });
});

/* DELETE /api/farms/:farmId */
/* GET /api/farms/:farmId/impact — ce qu'une suppression emporterait */
exports.farmImpact = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).select('name').lean();
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  const impact = await del.farmImpact(req.params.farmId);
  success(res, { farm, impact });
});

/**
 * DELETE /api/farms/:farmId
 *
 * Réservé à l'administrateur, et en cascade : supprimer la ferme seule laissait
 * ses passerelles, ses nœuds, ses alertes et son historique dans la base,
 * inaccessibles mais comptés par tous les agrégats.
 */
exports.deleteFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).select('name').lean();
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  const impact = await del.deleteFarm(req.params.farmId);
  success(res, { impact }, `Exploitation « ${farm.name} » supprimée`);
});

/**
 * POST /api/farms/:farmId/members — grant someone access to this farm.
 *
 * Only the owner or an administrator may hand out access; a member who was
 * merely invited must not be able to invite others, which is what the previous
 * `farmAccess()` guard alone allowed.
 *
 * The member role IS the permission level: `viewer` looks, `farmer` and
 * `technician` may act. Accepting a user id as well as an email lets the admin
 * screen pick from a list instead of retyping an address.
 */
exports.inviteMember = asyncHandler(async (req, res) => {
  const { email, userId, role = 'viewer' } = req.body;
  if (!['viewer', 'farmer', 'technician'].includes(role))
    return res.status(400).json({ success: false, message: 'Unknown access level' });

  const level = await accessLevelFor(req.user, req.params.farmId);
  if (level !== 'admin' && level !== 'owner')
    return res.status(403).json({ success: false, message: 'Only the owner or an administrator may share this farm' });

  const user = userId ? await User.findById(userId) : await User.findOne({ email });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const farm = await Farm.findById(req.params.farmId);
  if (String(farm.owner) === String(user._id))
    return res.status(409).json({ success: false, message: 'This user already owns the farm' });
  if (farm.hasMember(user._id)) return res.status(409).json({ success: false, message: 'Already a member' });
  farm.members.push({ user: user._id, role });
  await farm.save();
  success(res, { farm }, 'Member added');
});

/**
 * PATCH /api/farms/:farmId/members/:userId — change someone's access level.
 * Same rule as inviting: owner or administrator only.
 */
exports.updateMember = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['viewer', 'farmer', 'technician'].includes(role))
    return res.status(400).json({ success: false, message: 'Unknown access level' });

  const level = await accessLevelFor(req.user, req.params.farmId);
  if (level !== 'admin' && level !== 'owner')
    return res.status(403).json({ success: false, message: 'Only the owner or an administrator may change access' });

  const farm = await Farm.findById(req.params.farmId);
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  const m = farm.members.find((x) => String(x.user) === String(req.params.userId));
  if (!m) return res.status(404).json({ success: false, message: 'Not a member of this farm' });
  m.role = role;
  await farm.save();
  await farm.populate('members.user', 'name email role');
  success(res, { farm }, 'Access level updated');
});

/* DELETE /api/farms/:farmId/members/:userId */
exports.removeMember = asyncHandler(async (req, res) => {
  const level = await accessLevelFor(req.user, req.params.farmId);
  if (level !== 'admin' && level !== 'owner')
    return res.status(403).json({ success: false, message: 'Only the owner or an administrator may revoke access' });
  const farm = await Farm.findById(req.params.farmId);
  farm.members = farm.members.filter(m => !m.user.equals(req.params.userId));
  await farm.save();
  success(res, { farm }, 'Member removed');
});
