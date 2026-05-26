// ---------------------------------------------------------------------------
// externos.routes.js — Endpoints que simulan una API externa de personal
// ---------------------------------------------------------------------------
const { Router } = require('express')
const { ok, error } = require('../../utils/response')
const { buscarPorDni, buscarPorNombre, listar, validarParaSolicitud, } = require('./externos.service')
const { verifyToken } = require('../../middleware/auth')

const router = Router()

// Proteger con auth (requiere token)
router.use(verifyToken)

// GET /api/externos/personal?search=...&limit=20&offset=0
router.get('/personal', (req, res) => {
  try {
    const { search, limit = 20, offset = 0 } = req.query
    const result = listar({
      search,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
      offset: parseInt(offset, 10) || 0,
    })
    return ok(res, result)
  } catch (err) {
    console.error('externos.listar:', err)
    return error(res, 500, 'Error al consultar personal externo')
  }
})

// GET /api/externos/personal/:dni/validar-solicitud
router.get('/personal/:dni/validar-solicitud', async (req, res) => {
  try {
    const result = await validarParaSolicitud(req.params.dni)
    return ok(res, result)
  } catch (err) {
    console.error('externos.validarParaSolicitud:', err)
    return error(res, 500, 'Error al validar usuario para solicitud')
  }
})

// GET /api/externos/personal/:dni
router.get('/personal/:dni', (req, res) => {
  try {
    const persona = buscarPorDni(req.params.dni)
    if (!persona) return error(res, 404, 'Persona no encontrada')
    return ok(res, persona)
  } catch (err) {
    console.error('externos.buscarPorDni:', err)
    return error(res, 500, 'Error al buscar persona')
  }
})

// GET /api/externos/personal/buscar/:texto
router.get('/personal/buscar/:texto', (req, res) => {
  try {
    const resultados = buscarPorNombre(req.params.texto)
    return ok(res, resultados)
  } catch (err) {
    console.error('externos.buscarPorNombre:', err)
    return error(res, 500, 'Error al buscar persona')
  }
})

module.exports = router
