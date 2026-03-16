const router = require('express').Router();
const ctrl = require('./auth.controller');
const { verifyToken } = require('../../middleware/auth');

router.post('/login', ctrl.login);
router.post('/logout', verifyToken, ctrl.logout);

module.exports = router;
