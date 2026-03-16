const router = require('express').Router();
const { verifyToken } = require('../../middleware/auth');
const ctrl = require('./catalogos.controller');

router.use(verifyToken);
router.get('/servicios', ctrl.listarServicios);
router.get('/sedes', ctrl.listarSedes);
router.get('/roles', ctrl.listarRoles);

module.exports = router;
