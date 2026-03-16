const { ok, error } = require('../../utils/response')
const { obtenerServiciosAsignados, obtenerEstadisticas } = require('./perfil-ti.queries')

async function obtenerPerfilTi(req, res) {
  try {
    const idPersonal = req.user.idPersonal
    if (!idPersonal) return error(res, 400, 'Usuario sin personal asociado')

    const [servicios, estadisticas] = await Promise.all([
      obtenerServiciosAsignados(idPersonal),
      obtenerEstadisticas(idPersonal),
    ])

    return ok(res, { servicios, estadisticas })
  } catch (err) {
    console.error('perfil-ti.obtener:', err)
    return error(res, 500, 'Error al obtener perfil TI')
  }
}

module.exports = { obtenerPerfilTi }
