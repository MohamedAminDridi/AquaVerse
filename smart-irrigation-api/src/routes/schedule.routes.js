const router  = require('express').Router();
const ctrl    = require('../controllers/schedule.controller');
const { protect, farmAccess, farmControl, resourceAccess } = require('../middleware/auth.middleware');
const Schedule = () => require('../models/Schedule.model');

router.use(protect);
router.get   ('/farms/:farmId/schedules', farmAccess(),  ctrl.list);
router.post  ('/farms/:farmId/schedules', farmControl(), ctrl.create);
// Adressées par leur propre identifiant : sans garde, n'importe quel compte
// pouvait modifier ou supprimer le programme d'arrosage d'autrui.
router.patch ('/schedules/:id', resourceAccess(Schedule, 'id', { control: true }), ctrl.update);
router.delete('/schedules/:id', resourceAccess(Schedule, 'id', { control: true }), ctrl.remove);

module.exports = router;
