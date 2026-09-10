const router  = require('express').Router();
const ctrl    = require('../controllers/sensor.controller');
const { protect, farmAccess, nodeAccess } = require('../middleware/auth.middleware');

router.use(protect);
// Ces trois routes ne passent pas par /farms/:farmId : sans nodeAccess, un
// identifiant de nœud suffisait à lire l'historique de mesures d'autrui.
router.get('/nodes/:nodeId/data',       nodeAccess(), ctrl.getData);
router.get('/nodes/:nodeId/latest',     nodeAccess(), ctrl.getLatest);
router.get('/nodes/:nodeId/history',    nodeAccess(), ctrl.getHistory);
router.get('/farms/:farmId/live',       farmAccess(), ctrl.getLiveFeed);
router.get('/farms/:farmId/history',    farmAccess(), ctrl.getFarmHistory);
router.get('/farms/:farmId/export',     farmAccess(), ctrl.exportData);

module.exports = router;
