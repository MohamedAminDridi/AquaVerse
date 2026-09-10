const router  = require('express').Router();
const ctrl    = require('../controllers/farm.controller');
const { protect, authorize, farmAccess, farmControl } = require('../middleware/auth.middleware');

router.use(protect);
router.route('/')                                .get(ctrl.listFarms).post(ctrl.createFarm);
router.route('/:farmId')                         .get(farmAccess(), ctrl.getFarm)
                                                 .put(farmControl(), ctrl.updateFarm)
                                                 // Supprimer une exploitation emporte tout son contenu :
                                                 // réservé à l'administrateur, jamais au client.
                                                 .delete(authorize('admin'), ctrl.deleteFarm);
router.get('/:farmId/impact',                    authorize('admin'), ctrl.farmImpact);
router.post('/:farmId/members',                  farmAccess(), ctrl.inviteMember);
router.patch ('/:farmId/members/:userId',        farmAccess(), ctrl.updateMember);
router.delete('/:farmId/members/:userId',        farmAccess(), ctrl.removeMember);

module.exports = router;
