const { ok, error } = require('../../utils/response')
const {
  obtenerServiciosAsignados,
  obtenerEstadisticas,
  actualizarTelefono,
  actualizarCorreoPersonal,
} = require('./perfil-ti.queries')

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

async function actualizarTelefonoCtrl(req, res) {
  try {
    const idPersonal = req.user.idPersonal
    if (!idPersonal) return error(res, 400, 'Usuario sin personal asociado')

    const telefono = String(req.body.telefono || '').trim()

    if (!telefono) {
      return error(res, 400, 'El teléfono/anexo es obligatorio')
    }

    if (telefono.length > 20) {
      return error(res, 400, 'El teléfono/anexo no puede superar los 20 caracteres')
    }

    const formatoValido = /^[A-Za-z0-9ÁÉÍÓÚáéíóúÑñ\s/().-]+$/.test(telefono)

    if (!formatoValido) {
      return error(
        res,
        400,
        'El teléfono/anexo solo puede contener letras, números, espacios, guion, slash, punto o paréntesis',
      )
    }

    const actualizado = await actualizarTelefono(idPersonal, telefono)

    if (!actualizado) {
      return error(res, 404, 'Personal no encontrado')
    }

    return ok(res, {
      telefono: actualizado.telefono,
      message: 'Teléfono/anexo actualizado correctamente',
    })
  } catch (err) {
    console.error('perfil-ti.actualizarTelefono:', err)
    return error(res, 500, 'Error al actualizar teléfono/anexo')
  }
}

async function actualizarCorreoPersonalCtrl(req, res) {
  try {
    const idPersonal = req.user.idPersonal
    if (!idPersonal) return error(res, 400, 'Usuario sin personal asociado')

    const correoPersonal = String(req.body.correoPersonal || '').trim()

    if (!correoPersonal) {
      return error(res, 400, 'El correo personal es obligatorio')
    }

    if (correoPersonal.length > 150) {
      return error(res, 400, 'El correo personal no puede superar los 150 caracteres')
    }

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoPersonal)

    if (!emailValido) {
      return error(res, 400, 'Ingrese un correo personal válido')
    }

    const actualizado = await actualizarCorreoPersonal(idPersonal, correoPersonal)

    if (!actualizado) {
      return error(res, 404, 'Personal no encontrado')
    }

    return ok(res, {
      correoPersonal: actualizado.correo_personal,
      message: 'Correo personal actualizado correctamente',
    })
  } catch (err) {
    console.error('perfil-ti.actualizarCorreoPersonal:', err)
    return error(res, 500, 'Error al actualizar correo personal')
  }
}

module.exports = {
  obtenerPerfilTi,
  actualizarTelefono: actualizarTelefonoCtrl,
  actualizarCorreoPersonal: actualizarCorreoPersonalCtrl,
}