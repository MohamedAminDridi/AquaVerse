const router = require('express').Router();
const ctrl   = require('../controllers/overview.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/overview — one call, everything the app's first screen needs.
router.get('/', ctrl.overview);

module.exports = router;
