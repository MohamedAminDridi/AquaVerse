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

module.exports = router;
