const router = require('express').Router();
const ctrl   = require('../controllers/push.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/push
router.get ('/status',     ctrl.status);
router.post('/register',   ctrl.register);
router.post('/unregister', ctrl.unregister);
router.post('/test',       ctrl.test);

module.exports = router;
