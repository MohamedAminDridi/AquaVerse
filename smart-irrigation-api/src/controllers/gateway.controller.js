const Gateway      = require('../models/Gateway.model');
const AppError     = require('../utils/AppError');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const del = require('../services/deletion.service');

exports.listGateways = asyncHandler(async (req, res) => {
  const gateways = await Gateway.find({ farm: req.params.farmId }).sort('-createdAt');

  // Attach latest uptime_s from heartbeat_log so frontend shows correct uptime on load
  const enriched = gateways.map(gw => {
    const obj = gw.toObject();
    const latest = gw.heartbeat_log?.[gw.heartbeat_log.length - 1];
    obj.uptime_s = latest?.uptime_s ?? null;
    obj.rssi     = latest?.rssi     ?? null;
    return obj;
  });

  success(res, { gateways: enriched });
});

exports.createGateway = asyncHandler(async (req, res) => {
  const existing = await Gateway.findOne({ device_id: req.body.device_id });
  if (existing) throw new AppError('Device ID already registered.', 409);
  const gateway = await Gateway.create({ ...req.body, farm: req.params.farmId });
  created(res, { gateway }, 'Gateway registered');
});

exports.getGateway = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findOne({ _id: req.params.gwId, farm: req.params.farmId });
  if (!gateway) throw new AppError('Gateway not found.', 404);
  const obj    = gateway.toObject();
  const latest = gateway.heartbeat_log?.[gateway.heartbeat_log.length - 1];
  obj.uptime_s = latest?.uptime_s ?? null;
  obj.rssi     = latest?.rssi     ?? null;
  success(res, { gateway: obj });
});

exports.updateGateway = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findByIdAndUpdate(req.params.gwId, req.body, { new: true });
  success(res, { gateway });
});

/* GET /api/farms/:farmId/gateways/:gwId/impact */
exports.gatewayImpact = asyncHandler(async (req, res) => {
  const gw = await Gateway.findById(req.params.gwId).select('name device_id farm').lean();
  if (!gw) return res.status(404).json({ success: false, message: 'Gateway not found' });
  const impact = await del.gatewayImpact(req.params.gwId);
  // Les autres passerelles de la même ferme, pour proposer un réaffectation.
  const others = await Gateway.find({ farm: gw.farm, _id: { $ne: gw._id } })
    .select('name device_id').lean();
  success(res, { gateway: gw, impact, others });
});

/**
 * DELETE /api/farms/:farmId/gateways/:gwId?mode=detach|reassign|cascade
 *
 * `mode` dit ce qu'il advient des nœuds qu'elle relayait. Par défaut ils sont
 * détachés explicitement plutôt que laissés à pointer vers un document effacé.
 */
exports.deleteGateway = asyncHandler(async (req, res) => {
  const gw = await Gateway.findById(req.params.gwId).select('name device_id').lean();
  if (!gw) return res.status(404).json({ success: false, message: 'Gateway not found' });
  const mode = ['detach', 'reassign', 'cascade'].includes(req.query.mode) ? req.query.mode : 'detach';
  if (mode === 'reassign' && !req.query.reassignTo)
    return res.status(400).json({ success: false, message: 'reassignTo is required for mode=reassign' });
  await del.deleteGateway(req.params.gwId, { mode, reassignTo: req.query.reassignTo });
  res.status(204).send();
});

exports.getHeartbeats = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findById(req.params.gwId);
  if (!gateway) throw new AppError('Gateway not found.', 404);
  const log = (gateway.heartbeat_log || []).slice(-50).reverse();
  success(res, { heartbeats: log });
});