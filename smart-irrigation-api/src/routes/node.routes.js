const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/node.controller');
const { protect, farmAccess, farmControl } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/farms/:farmId/nodes
// Même correction que pour les passerelles : les routes d'élément étaient ouvertes.
router.route('/')           .get(farmAccess(),  ctrl.listNodes)
                            .post(farmControl(), ctrl.createNode);
router.route('/:nodeId')    .get(farmAccess(),  ctrl.getNode)
                            .put(farmControl(), ctrl.updateNode)
                            .delete(farmControl(), ctrl.deleteNode);
router.get  ('/:nodeId/impact', farmControl(), ctrl.nodeImpact);
router.get  ('/:nodeId/status', farmAccess(),  ctrl.getLiveStatus);

module.exports = router;