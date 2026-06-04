const { ok, error, created } = require('../../utils/response')
const { parsePagination } = require('../../utils/pagination')
const queries = require('./personal.queries')
const externosService = require('../externos/externos.service')

/* ───────── GET / ───────── */

async function listar(req, res) {
  try {
    const { limit: defaultLimit, offset } = parsePagination(req)

    const limit = req.query.limit === '9999' ? 5000 : defaultLimit

    const filters = {
      search: req.query.search || null,
      vinculo: req.query.vinculo || null,
      sede: req.query.sede || null,
      estado: req.query.estado || null,
      limit,
      offset,
    }

    const { data, total } = await queries.listar(filters)
    return ok(res, { data, total })
  } catch (err) {
    console.error('personal.listar:', err)
    return error(res, 500, 'Error al listar personal')
  }
}

/* ───────── GET /:id ───────── */

async function obtenerPorId(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID inválido')

    const row = await queries.obtenerPorId(id)
    if (!row) return error(res, 404, 'Personal no encontrado')

    return ok(res, row)
  } catch (err) {
    console.error('personal.obtenerPorId:', err)
    return error(res, 500, 'Error al obtener personal')
  }
}

/* ───────── POST / ───────── */

async function crear(req, res) {
  try {
    const {
      dni,
      apellidos,
      nombres,
      tipoVinculo,
      cargo,
      correo,
      telefono,
      oficina,
      sede,
      roles,
      activo,
    } = req.body

    if (!dni || !apellidos || !nombres) {
      return error(res, 400, 'DNI, apellidos y nombres son obligatorios')
    }

    const result = await queries.crear({
      dni,
      apellidos,
      nombres,
      tipoVinculo,
      cargo,
      correo,
      telefono,
      oficina,
      sede,
      roles,
      activo,
    })

    return created(res, result)
  } catch (err) {
    console.error('personal.crear:', err)

    if (err.code === '23505') {
      return error(res, 409, 'El DNI ya se encuentra registrado')
    }

    return error(res, 500, 'Error al crear personal')
  }
}

/* ───────── PUT /:id ───────── */

async function actualizar(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return error(res, 400, 'ID inválido')

    const { cargo, oficina, sede, roles, activo } = req.body

    const result = await queries.actualizar(id, {
      cargo,
      oficina,
      sede,
      roles,
      activo,
    })

    if (!result) return error(res, 404, 'Personal no encontrado')

    return ok(res, result)
  } catch (err) {
    console.error('personal.actualizar:', err)
    return error(res, 500, 'Error al actualizar personal')
  }
}

/* ───────── POST /sincronizar ───────── */

const VINCULO_MAP = {
  OS: 'Orden de Servicio',
  CAS: 'CAS',
  NOMBRADO: 'Nombrado',
  PRACTICANTE: 'Practicante',
  LOCADOR: 'Locador',
  CAP: 'CAP',
  '728': '728',
  '276': '276',
}

function normalizarVinculo(value) {
  const raw = String(value || '').trim()
  const key = raw.toUpperCase()

  return VINCULO_MAP[key] || raw
}

async function sincronizar(req, res) {
  try {
    const externosData = externosService.listar({ limit: 999999, offset: 0 })
    const lista = externosData.data

    if (!lista || lista.length === 0) {
      return error(res, 400, 'No se encontraron registros en la fuente externa')
    }

    const listaExternos = lista.map((ext) => ({
      dni: ext.dni,
      apellidos: ext.apellidos,
      nombres: ext.nombres,
      tipoVinculo: normalizarVinculo(ext.tipoVinculo),
      cargo: ext.cargo,
      correo: ext.correo,
      celular: ext.celular,
      unidad: ext.unidad,
      sede: ext.sede,

      numOrdenServicio: ext.orden || null,
      fechaInicioContrato: ext.fechaInicioContrato || null,
      fechaFinContrato: ext.fechaFinContrato || null,
      estado: ext.estado || 'ACTIVO',
    }))

    const result = await queries.sincronizar(listaExternos)

    return ok(res, {
      mensaje: `Sincronización completada: ${result.created} creados, ${result.updated} actualizados`,
      ...result,
      totalProcesados: lista.length,
    })
  } catch (err) {
    console.error('personal.sincronizar:', err)
    return error(res, 500, 'Error al sincronizar personal desde fuente externa')
  }
}

module.exports = {
  listar,
  obtenerPorId,
  crear,
  actualizar,
  sincronizar,
}