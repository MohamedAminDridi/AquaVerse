const router  = require('express').Router();
const ctrl    = require('../controllers/weather.controller');
const { protect, farmAccess, authorize } = require('../middleware/auth.middleware');

router.use(protect);
// La météo est rattachée à une exploitation : même périmètre que le reste.
router.get ('/:farmId/current',   farmAccess(), ctrl.getCurrent);
router.get ('/:farmId/live',      farmAccess(), ctrl.getLive);
router.get ('/:farmId/forecast',  farmAccess(), ctrl.getForecast);
router.get ('/:farmId/daily',     farmAccess(), ctrl.getDaily);
router.get ('/:farmId/history',   farmAccess(), ctrl.getHistory);
router.get ('/:farmId/et0',       farmAccess(), ctrl.getET0);
router.post('/stations',          authorize('admin', 'technician'), ctrl.registerStation);

module.exports = router;