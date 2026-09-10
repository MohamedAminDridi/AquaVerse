const Node          = require('../models/Node.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const del = require('../services/deletion.service');

exports.listNodes = asyncHandler(async (req, res) => {
  const { status, gateway } = req.query;
  const filter = { farm: req.params.farmId };
  if (status)  filter.status  = status;
  if (gateway) filter.gateway = gateway;
  const nodes = await Node.find(filter).populate('gateway', 'name device_id').sort('name');
  success(res, { nodes });
});

exports.createNode = asyncHandler(async (req, res) => {
  const node = await Node.create({ ...req.body, farm: req.params.farmId });
  created(res, { node }, 'Node registered');
});

exports.getNode = asyncHandler(async (req, res) => {
  const node = await Node.findOne({ _id: req.params.nodeId, farm: req.params.farmId })
    .populate('gateway', 'name device_id status');
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  success(res, { node });
});

exports.updateNode = asyncHandler(async (req, res) => {
  const node = await Node.findByIdAndUpdate(req.params.nodeId, req.body, { new: true, runValidators: true });
  success(res, { node });
});

/* GET /api/farms/:farmId/nodes/:nodeId/impact */
exports.nodeImpact = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId).select('name device_id').lean();
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const impact = await del.nodeImpact(req.params.nodeId);
  success(res, { node, impact });
});

/**
 * DELETE /api/farms/:farmId/nodes/:nodeId
 *
 * En cascade : l'historique de mesures, les commandes, les alertes et les
 * programmes qui ne visaient que ce nœud partent avec lui. Un programme qui
 * visait toute l'exploitation est conservé.
 */
exports.deleteNode = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId).select('name device_id').lean();
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const impact = await del.deleteNode(req.params.nodeId);
  success(res, { impact }, `Nœud « ${node.name || node.device_id} » supprimé`);
});

exports.getLiveStatus = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  success(res, {
    node_id:      node._id,
    device_id:    node.device_id,
    status:       node.status,
    valve_state:  node.valve_state,
    pump_state:   node.pump_state,
    battery_pct:  node.battery_pct,
    last_seen:    node.last_seen,
  });
});
