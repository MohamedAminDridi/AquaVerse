const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const { brokerStatus, setCloudEnabled } = require('../mqtt/mqttClient');

// Admin-only system controls.
router.use(protect, authorize('admin'));

// GET /api/system/broker — current local + cloud broker status.
router.get('/broker', asyncHandler(async (req, res) =>
  success(res, { broker: brokerStatus() })));

// PUT /api/system/broker { cloud: true|false } — toggle the cloud broker live.
router.put('/broker', asyncHandler(async (req, res) => {
  const cloud = !!req.body.cloud;
  const broker = await setCloudEnabled(cloud);
  success(res, { broker }, cloud ? 'Cloud broker enabled' : 'Cloud broker disabled');
}));

// ── Edge-AI master switch ────────────────────────────────────────────────────
// Controls whether nodes may act on their on-device models when AUTONOMOUS.
// The flag rides inside every heartbeat beacon (HB_FLAG_AI_ENABLED), so the
// whole farm flips within one beacon period (≤10 s). Persisted in SystemSetting.
const SystemSetting = require('../models/SystemSetting.model');

// GET /api/system/ai — current state of the edge-AI switch.
router.get('/ai', asyncHandler(async (req, res) => {
  const doc = await SystemSetting.findOne({ key: 'ai' });
  success(res, { ai: { enabled: !!doc?.aiEnabled } });
}));

// PUT /api/system/ai { enabled: true|false } — flip the edge-AI switch.
router.put('/ai', asyncHandler(async (req, res) => {
  const enabled = !!req.body.enabled;
  await SystemSetting.findOneAndUpdate(
    { key: 'ai' }, { aiEnabled: enabled }, { upsert: true, new: true });
  success(res, { ai: { enabled } },
    enabled ? 'Edge AI enabled — nodes may decide when autonomous'
            : 'Edge AI disabled — nodes fall back to conservative rules');
}));

module.exports = router;
