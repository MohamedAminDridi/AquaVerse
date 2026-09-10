const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/gateway.controller');
const { protect, farmAccess, farmControl } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/farms/:farmId/gateways
// Les routes d'élément n'avaient AUCUNE garde : un identifiant suffisait à lire,
// modifier ou supprimer la passerelle de n'importe quelle exploitation.
router.route('/')          .get(farmAccess(),  ctrl.listGateways)
                           .post(farmControl(), ctrl.createGateway);
router.route('/:gwId')     .get(farmAccess(),  ctrl.getGateway)
                           .put(farmControl(), ctrl.updateGateway)
                           .delete(farmControl(), ctrl.deleteGateway);
router.get  ('/:gwId/impact',     farmControl(), ctrl.gatewayImpact);
router.get  ('/:gwId/heartbeats', farmAccess(),  ctrl.getHeartbeats);

module.exports = router;