const router = require('express').Router();
const { verifyToken } = require('../../middleware/auth');
const ctrl = require('./bandeja.controller');

router.use(verifyToken);
router.get('/', ctrl.listar);
router.post('/:id/decidir', ctrl.decidir);
router.post('/:id/atender', ctrl.atender);

module.exports = router;
