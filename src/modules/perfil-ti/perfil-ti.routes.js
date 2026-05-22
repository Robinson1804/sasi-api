const router = require('express').Router()
const { verifyToken } = require('../../middleware/auth')
const ctrl = require('./perfil-ti.controller')

router.use(verifyToken)

router.get('/', ctrl.obtenerPerfilTi)
router.patch('/telefono', ctrl.actualizarTelefono)

module.exports = router