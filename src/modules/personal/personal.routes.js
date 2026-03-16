const router = require('express').Router();
const { verifyToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/role');
const ctrl = require('./personal.controller');

router.use(verifyToken);
router.use(requireRole('administrador_sasi'));

router.get('/',              ctrl.listar);
router.post('/sincronizar',  ctrl.sincronizar);
router.get('/:id',           ctrl.obtenerPorId);
router.post('/',   ctrl.crear);
router.put('/:id', ctrl.actualizar);

module.exports = router;
