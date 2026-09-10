const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/alert.controller');
const { protect, farmAccess, farmControl, resourceAccess } = require('../middleware/auth.middleware');
const AlertRule = () => require('../models/AlertRule.model');

router.use(protect);

// Mounted at /api/farms/:farmId/alert-rules
router.get ('/',          farmAccess(),  ctrl.listRules);
router.post('/',          farmControl(), ctrl.createRule);
router.put   ('/:ruleId', resourceAccess(AlertRule, 'ruleId', { control: true }), ctrl.updateRule);
router.delete('/:ruleId', resourceAccess(AlertRule, 'ruleId', { control: true }), ctrl.deleteRule);

module.exports = router;