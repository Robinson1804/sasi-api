// ---------------------------------------------------------------------------
// solicitudes.controller.js — Controladores REST para Solicitudes
// ---------------------------------------------------------------------------
const { ok, error, created } = require('../../utils/response')
const { parsePagination } = require('../../utils/pagination')
const { registrarAuditoria } = require('../../utils/audit')
const queries = require('./solicitudes.queries')
const { mapSolicitudRow } = require('./solicitudes.helpers')

// GET /solicitudes
async function listar(req, res) {
  try {
    const { limit, offset, page } = parsePagination(req)
    const { estado, servicio, sede, periodo, search } = req.query

    // Si el usuario es solicitante, solo ve sus propias solicitudes
    const roles = req.user.roles || []
    const esSolicitante = roles.length === 1 && roles[0] === 'usuario_solicitante'

    const filters = {
      estado:         estado        || undefined,
      servicio:       servicio      || undefined,
      sede:           sede          || undefined,
      periodo:        periodo       || undefined,
      search:         search        || undefined,
      idSolicitante:  esSolicitante ? req.user.idPersonal : undefined,
      limit,
      offset,
    }

    const { rows, total } = await queries.listar(filters)

    const data = rows.map(mapSolicitudRow)

    return ok(res, {
      data,
      paginacion: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('solicitudes.listar:', err)
    return error(res, 500, 'Error al listar solicitudes')
  }
}

// GET /solicitudes/:id
async function obtenerPorId(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID invalido')

    const resultado = await queries.obtenerPorId(id)
    if (!resultado) return error(res, 404, 'Solicitud no encontrada')

    const solicitud = mapSolicitudRow(resultado.solicitud)

    return ok(res, {
      ...solicitud,
      servicios:          resultado.servicios,
      etapas:             resultado.etapas,
      historial:          resultado.historial,
      solicitudesHijas:   resultado.solicitudesHijas,
      usuariosMasivos:    resultado.usuariosMasivos,
    })
  } catch (err) {
    console.error('solicitudes.obtenerPorId:', err)
    return error(res, 500, 'Error al obtener la solicitud')
  }
}

// POST /solicitudes
async function crear(req, res) {
  try {
    const { tipo, servicios, usuariosMasivos, compromisoAceptado } = req.body

    // Validaciones basicas
    if (!servicios || !Array.isArray(servicios) || servicios.length === 0) {
      return error(res, 400, 'Debe seleccionar al menos un servicio')
    }

    for (const srv of servicios) {
      if (!srv.codigoServicio) {
        return error(res, 400, 'Cada servicio debe tener un codigoServicio')
      }
    }

    if (tipo === 'masiva' && (!usuariosMasivos || usuariosMasivos.length === 0)) {
      return error(res, 400, 'Una solicitud masiva requiere al menos un usuario')
    }

    const result = await queries.crear({
      idSolicitante: req.user.idPersonal,
      tipo: tipo || 'individual',
      servicios,
      usuariosMasivos,
    })

    // Auditoria
    await registrarAuditoria(
      req.user.id, 'CREAR_SOLICITUD', 'solicitudes',
      String(result.id), null, { numero: result.numero, tipo, servicios },
      req.ip
    )

    return created(res, result)
  } catch (err) {
    console.error('solicitudes.crear:', err)
    const msg = err.message.includes('no encontrado')
      ? err.message
      : 'Error al crear la solicitud'
    return error(res, err.message.includes('no encontrado') ? 400 : 500, msg)
  }
}

// POST /solicitudes/:id/enviar
async function enviar(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID invalido')

    const solicitudActualizada = await queries.enviar(id, req.user.id)
    const mapped = mapSolicitudRow(solicitudActualizada)

    // Auditoria
    await registrarAuditoria(
      req.user.id, 'ENVIAR_SOLICITUD', 'solicitudes',
      String(id), { estado: 'borrador' }, { estado: 'enviada' },
      req.ip
    )

    return ok(res, mapped)
  } catch (err) {
    console.error('solicitudes.enviar:', err)
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('No se puede') ? 400
      : 500
    return error(res, status, err.message)
  }
}

// POST /solicitudes/:id/cancelar
async function cancelar(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID invalido')

    const { motivo } = req.body

    const result = await queries.cancelar(id, req.user.id, motivo)

    // Auditoria
    await registrarAuditoria(
      req.user.id, 'CANCELAR_SOLICITUD', 'solicitudes',
      String(id), null, { estado: 'cancelada', motivo },
      req.ip
    )

    return ok(res, result)
  } catch (err) {
    console.error('solicitudes.cancelar:', err)
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('No se puede') ? 400
      : 500
    return error(res, status, err.message)
  }
}

// POST /solicitudes/:id/confirmar-firmado
async function confirmarFirmado(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID invalido')

    const result = await queries.confirmarFirmado(id, req.user.id)

    await registrarAuditoria(
      req.user.id, 'CONFIRMAR_FIRMADO', 'solicitudes',
      String(id), null, { estado: result.estado },
      req.ip
    )

    return ok(res, result)
  } catch (err) {
    console.error('solicitudes.confirmarFirmado:', err)
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('No se ha subido') ? 400
      : 500
    return error(res, status, err.message)
  }
}

module.exports = { listar, obtenerPorId, crear, enviar, cancelar, confirmarFirmado }
