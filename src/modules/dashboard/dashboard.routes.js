const router = require('express').Router();
const { verifyToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/role');
const ctrl = require('./dashboard.controller');

router.use(verifyToken);
router.use(requireRole('administrador_sasi', 'jefe_supervisor', 'seguridad_accesos', 'equipo_redes', 'dba', 'soporte_tecnico'));

router.get('/kpis', ctrl.kpis);
router.get('/servicios', ctrl.serviciosStats);
router.get('/alertas-sla', ctrl.alertasSla);

module.exports = router;
