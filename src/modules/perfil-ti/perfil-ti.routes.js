const router = require('express').Router()
const { verifyToken } = require('../../middleware/auth')
const ctrl = require('./perfil-ti.controller')

router.use(verifyToken)
router.get('/', ctrl.obtenerPerfilTi)

module.exports = router
