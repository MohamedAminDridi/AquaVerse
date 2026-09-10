const Farm = require('../models/Farm.model');

/**
 * Which farms is this user allowed to see?
 *
 * Every listing endpoint must go through here. Before this existed, several
 * controllers queried `Farm.find()` with no filter at all, so any authenticated
 * account — including a freshly created client — received the entire fleet.
 * Scoping in one place means a new endpoint cannot forget it by omission: it
 * either calls this and is safe, or it does not and the omission is visible.
 *
 * An admin sees everything by design; that is what the role is for.
 */
async function farmIdsFor(user) {
  if (!user) return [];
  if (user.role === 'admin') return Farm.find().distinct('_id');
  return Farm.find({
    $or: [{ owner: user._id }, { 'members.user': user._id }],
  }).distinct('_id');
}

/**
 * How much this user may do on this farm.
 *
 *   'admin'   — platform administrator, everything
 *   'owner'   — the client the farm belongs to, everything on that farm
 *   'control' — invited and allowed to act: valves, schedules, acknowledging
 *   'view'    — invited to look only
 *   null      — no relationship at all
 *
 * Membership roles map onto this: `viewer` reads, `farmer` and `technician`
 * act. Returning a level rather than a boolean is what lets the interface
 * hide a control instead of offering one that will be refused.
 */
const CONTROL_ROLES = new Set(['farmer', 'technician', 'owner']);

async function accessLevelFor(user, farmId) {
  if (!user || !farmId) return null;
  if (user.role === 'admin') return 'admin';

  const farm = await Farm.findById(farmId).select('owner members').lean();
  if (!farm) return null;

  const id = String(user._id);
  if (String(farm.owner) === id) return 'owner';

  const m = (farm.members || []).find((x) => String(x.user) === id);
  if (!m) return null;
  return CONTROL_ROLES.has(m.role) ? 'control' : 'view';
}

/** True when the user may read this farm. */
async function canAccessFarm(user, farmId) {
  return (await accessLevelFor(user, farmId)) !== null;
}

/** True when the user may act on this farm — open a valve, edit a programme. */
async function canControlFarm(user, farmId) {
  const level = await accessLevelFor(user, farmId);
  return level === 'admin' || level === 'owner' || level === 'control';
}

/** Access level for every farm the user can reach, keyed by farm id. */
async function accessMapFor(user) {
  if (!user) return {};
  if (user.role === 'admin') {
    const ids = await Farm.find().distinct('_id');
    return Object.fromEntries(ids.map((id) => [String(id), 'admin']));
  }
  const farms = await Farm.find({
    $or: [{ owner: user._id }, { 'members.user': user._id }],
  }).select('owner members').lean();

  const id = String(user._id);
  const out = {};
  for (const f of farms) {
    if (String(f.owner) === id) { out[String(f._id)] = 'owner'; continue; }
    const m = (f.members || []).find((x) => String(x.user) === id);
    out[String(f._id)] = m && CONTROL_ROLES.has(m.role) ? 'control' : 'view';
  }
  return out;
}

/**
 * Turn a caller-supplied `farm` query parameter into a filter that can never
 * widen the user's own scope: an unknown or foreign id yields an empty result
 * rather than someone else's data.
 */
async function farmFilterFor(user, requestedFarmId) {
  const allowed = await farmIdsFor(user);
  if (!requestedFarmId) return { $in: allowed };
  const ok = allowed.some((id) => String(id) === String(requestedFarmId));
  return ok ? requestedFarmId : { $in: [] };
}

module.exports = {
  farmIdsFor, accessLevelFor, canAccessFarm, canControlFarm,
  accessMapFor, farmFilterFor,
};
