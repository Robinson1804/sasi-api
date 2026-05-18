const router = require('express').Router();
const ctrl = require('./auth.controller');
const { verifyToken } = require('../../middleware/auth');

router.post('/login', ctrl.login);
router.post('/logout', verifyToken, ctrl.logout);
router.post('/change-password', verifyToken, ctrl.changePassword);

module.exports = router;
