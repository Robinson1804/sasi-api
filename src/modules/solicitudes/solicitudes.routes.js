// ---------------------------------------------------------------------------
// solicitudes.routes.js — Rutas REST para el modulo de Solicitudes
// ---------------------------------------------------------------------------
const router = require('express').Router()
const { verifyToken } = require('../../middleware/auth')
const ctrl = require('./solicitudes.controller')

router.use(verifyToken)

router.get('/',              ctrl.listar)
router.get('/:id',           ctrl.obtenerPorId)
router.post('/',             ctrl.crear)
router.post('/:id/enviar',            ctrl.enviar)
router.post('/:id/confirmar-firmado', ctrl.confirmarFirmado)
router.post('/:id/cancelar',         ctrl.cancelar)

module.exports = router
