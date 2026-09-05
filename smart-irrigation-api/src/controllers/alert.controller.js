const mongoose    = require('mongoose');
const Alert       = require('../models/Alert.model');
const Node        = require('../models/Node.model');
const AlertRule   = require('../models/AlertRule.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created, paginated } = require('../utils/apiResponse');

// Per-farm alert counts for the Alerts screen's farm grid. Aggregated in the DB
// rather than counted client-side, because listAlerts is paginated (20/page) and
// would otherwise under-report any farm past the first page. Returns a map keyed
// by farm id; the client merges it with its own /farms list so farms with zero
// alerts still get a card (and so farm scoping stays owned by /farms).
exports.alertSummary = asyncHandler(async (req, res) => {
  // ?by=gateway&farm=<id> → counts per GATEWAY within one farm, for the Alerts
  // screen's farm → gateway drill-down. An alert belongs to a gateway either
  // directly (alert.gateway) or through its node (node.gateway), so the pipeline
  // resolves both into one key before grouping.
  if (req.query.by === 'gateway') {
    const { farm } = req.query;
    if (!farm) return res.status(400).json({ success: false, message: 'farm is required for by=gateway' });
    const rows = await Alert.aggregate([
      { $match: { farm: new mongoose.Types.ObjectId(String(farm)) } },
      { $lookup: { from: 'nodes', localField: 'node', foreignField: '_id', as: '_n' } },
      { $addFields: { gw: { $ifNull: ['$gateway', { $arrayElemAt: ['$_n.gateway', 0] }] } } },
      { $group: {
        _id:            '$gw',
        total:          { $sum: 1 },
        unacknowledged: { $sum: { $cond: [{ $eq: ['$acknowledged', false] }, 1, 0] } },
        critical:       { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'critical'] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        warning:        { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'warning'] },  { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        // how many are the gateway's OWN problem rather than a node's — the UI
        // surfaces these first instead of diving straight into node alerts
        // $ifNull matters: an alert about a node has NO gateway field at all, and a
        // missing field does not compare equal to null in an aggregation expression
        // the way it does in a find() query. Without it every node alert counted as
        // a gateway alert — the tab said 124 while the list showed none.
        ownOpen:        { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$gateway', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        nodeOpen:       { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$node', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
        latest:         { $max: '$createdAt' },
      } },
    ]);
    const byGateway = {};
    let unassigned = null;
    for (const r of rows) {
      const { _id, ...counts } = r;
      if (_id) byGateway[String(_id)] = counts; else unassigned = counts;
    }
    return success(res, { byGateway, unassigned });
  }

  const rows = await Alert.aggregate([
    { $group: {
      _id:            '$farm',
      total:          { $sum: 1 },
      unacknowledged: { $sum: { $cond: [{ $eq: ['$acknowledged', false] }, 1, 0] } },
      critical:       { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'critical'] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
      warning:        { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'warning'] },  { $eq: ['$acknowledged', false] }] }, 1, 0] } },
      // open alerts split by what they are ABOUT, so a farm tile can say
      // "2 gateway / 9 node" instead of one undifferentiated number
      gatewayOpen:    { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$gateway', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
      nodeOpen:       { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$node', null] }, null] }, { $eq: ['$acknowledged', false] }] }, 1, 0] } },
      latest:         { $max: '$createdAt' },
    } },
  ]);
  const byFarm = {};
  for (const r of rows) {
    if (!r._id) continue;
    const { _id, ...counts } = r;
    byFarm[String(_id)] = counts;
  }
  success(res, { byFarm });
});

exports.listAlerts = asyncHandler(async (req, res) => {
  const { farm, gateway, scope, kind, severity, acknowledged, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (farm)         filter.farm = farm;
  // An alert is about a GATEWAY (alert.gateway set), a NODE (alert.node set), or
  // neither — a farm-level system alert. That distinction is what the Alerts
  // screen's type filter drives.
  if (kind === 'gateway')     filter.gateway = { $ne: null };
  else if (kind === 'node')   filter.node    = { $ne: null };
  else if (kind === 'system') { filter.gateway = null; filter.node = null; }
  // A gateway "owns" two kinds of alert: its own (alert.gateway) and those of the
  // nodes hanging off it (alert.node -> node.gateway). `scope` narrows to one:
  //   'self'  → only the gateway's own alerts
  //   'nodes' → only its nodes' alerts
  //   absent  → both
  if (gateway) {
    const own = { gateway };
    if (scope === 'self') {
      Object.assign(filter, own);
    } else {
      const nodeIds = await Node.find({ gateway }).distinct('_id');
      filter.$or = scope === 'nodes'
        ? [{ node: { $in: nodeIds } }]
        : [own, { node: { $in: nodeIds } }];
    }
  }
  if (severity)     filter.severity = severity;
  if (acknowledged !== undefined) filter.acknowledged = acknowledged === 'true';
  const total  = await Alert.countDocuments(filter);
  const alerts = await Alert.find(filter)
    .populate('node', 'name device_id')
    // farm name: the Alerts screen has cross-farm views (all criticals, all
    // acknowledged) where a row has to say which farm it came from.
    .populate('farm', 'name')
    .populate('gateway', 'name device_id')
    // who acknowledged it — shown in the Acknowledged view.
    .populate('acknowledged_by', 'name email role')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(parseInt(limit));
  paginated(res, alerts, +page, +limit, total);
});

exports.getAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id)
    .populate('node', 'name device_id').populate('acknowledged_by', 'name');
  if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
  success(res, { alert });
});

exports.acknowledgeAlert = asyncHandler(async (req, res) => {
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  const alert = await Alert.findByIdAndUpdate(req.params.id, {
    acknowledged: true, acknowledged_by: req.user._id, acknowledged_at: new Date(),
    acknowledged_note: note,
  }, { new: true }).populate('acknowledged_by', 'name email role');
  success(res, { alert }, 'Alert acknowledged');
});

/* Alert rules */
exports.listRules = asyncHandler(async (req, res) => {
  const rules = await AlertRule.find({ farm: req.params.farmId }).populate('node','name');
  success(res, { rules });
});

exports.createRule = asyncHandler(async (req, res) => {
  const rule = await AlertRule.create({ ...req.body, farm: req.params.farmId });
  created(res, { rule }, 'Alert rule created');
});

exports.updateRule = asyncHandler(async (req, res) => {
  const rule = await AlertRule.findByIdAndUpdate(req.params.ruleId, req.body, { new: true });
  success(res, { rule });
});

exports.deleteRule = asyncHandler(async (req, res) => {
  await AlertRule.findByIdAndDelete(req.params.ruleId);
  res.status(204).send();
});
