const router  = require('express').Router();
const ctrl    = require('../controllers/irrigation.controller');
const { protect, nodeAccess } = require('../middleware/auth.middleware');

router.use(protect);
// Le périmètre est posé ici, une fois par route : agir demande le droit de
// contrôle, lire se contente de l'accès. Les contrôles internes aux handlers
// restent en place — une garde de route ne protège pas un appel interne.
router.post('/nodes/:nodeId/valve/open',        nodeAccess({ control: true }), ctrl.openValve);
router.post('/nodes/:nodeId/valve/close',       nodeAccess({ control: true }), ctrl.closeValve);
router.post('/nodes/:nodeId/valve/toggle',      nodeAccess({ control: true }), ctrl.toggleValve);
router.post('/nodes/:nodeId/pump/start',        nodeAccess({ control: true }), ctrl.startPump);
router.post('/nodes/:nodeId/pump/stop',         nodeAccess({ control: true }), ctrl.stopPump);
router.get ('/nodes/:nodeId/commands',          nodeAccess(), ctrl.getCommands);
router.get ('/nodes/:nodeId/commands/:cmdId',   nodeAccess(), ctrl.getCommandStatus);

// Deep-sleep duty cycle
router.get ('/nodes/:nodeId/sleep',             nodeAccess(), ctrl.getSleep);
router.put ('/nodes/:nodeId/sleep',             nodeAccess({ control: true }), ctrl.setSleep);
router.post('/nodes/:nodeId/sleep/now',         nodeAccess({ control: true }), ctrl.sleepNow);
router.post('/nodes/:nodeId/sleep/wake',        nodeAccess({ control: true }), ctrl.wakeNode);

module.exports = router;
