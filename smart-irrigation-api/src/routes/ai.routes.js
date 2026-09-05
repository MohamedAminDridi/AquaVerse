const router = require('express').Router();
const { protect } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const Decision = require('../models/Decision.model');
const Node     = require('../models/Node.model');
const forecast = require('../services/forecast.service');

router.use(protect);

// GET /api/ai/forecast?farmId=… — latest soil forecast per node (computed by the
// autopilot cron; recomputed on demand if the cache is empty).
router.get('/forecast', asyncHandler(async (req, res) => {
  const { farmId } = req.query;
  const nodes = await Node.find(farmId ? { farm: farmId } : {}).select('device_id ai');
  let forecasts = forecast.latestAll(nodes.map((n) => n.device_id));
  if (!forecasts.length && farmId) {
    const Farm = require('../models/Farm.model');
    const farm = await Farm.findById(farmId).select('location name');
    if (farm) forecasts = (await forecast.runFarm(farm, nodes)).forecasts.filter((f) => f.ok);
  }
  success(res, { forecasts, horizon_h: forecast.HORIZON_H });
}));

// GET /api/ai/rain?farmId=… — fused rain view: on-site sensor (now) + forecast
// (future) + the rolling confidence in that forecast.
router.get('/rain', asyncHandler(async (req, res) => {
  const rain = require('../services/rain.service');
  const farmId = req.query.farmId;
  success(res, {
    rain: {
      sensor: rain.current(farmId),
      rainingNow: rain.isRainingNow(farmId),
      confidence: rain.confidence(farmId),
    },
  });
}));

// PUT /api/ai/node/:nodeId/autopilot { autoIrrigate, soilTarget } — opt a node
// into closed-loop auto-irrigation and set its soil target.
router.put('/node/:nodeId/autopilot', asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  if (!node.ai) node.ai = {};
  if (req.body.autoIrrigate != null) node.ai.autoIrrigate = !!req.body.autoIrrigate;
  if (req.body.soilTarget   != null) node.ai.soilTarget = Math.max(5, Math.min(95, +req.body.soilTarget));
  node.markModified('ai');
  await node.save();
  success(res, { ai: node.ai }, 'Autopilot updated');
}));

// GET /api/ai/decisions?farmId=…&limit=50 — newest shadow decisions + the
// running agreement % the AI Brain layer displays on the brain.
router.get('/decisions', asyncHandler(async (req, res) => {
  const { farmId, limit = 50 } = req.query;
  const filter = farmId ? { farm: farmId } : {};
  const decisions = await Decision.find(filter)
    .sort({ ts: -1 }).limit(Math.min(+limit || 50, 200)).lean();
  const judged = decisions.filter((d) => d.agree != null);
  const agreePct = judged.length
    ? Math.round((judged.filter((d) => d.agree).length / judged.length) * 100)
    : null;
  success(res, { decisions, agreePct });
}));

module.exports = router;
