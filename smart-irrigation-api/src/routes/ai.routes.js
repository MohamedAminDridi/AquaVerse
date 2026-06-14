const router = require('express').Router();
const { protect } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const Decision = require('../models/Decision.model');

router.use(protect);

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
