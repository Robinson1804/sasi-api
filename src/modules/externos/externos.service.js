// ---------------------------------------------------------------------------
// externos.service.js — Servicio que simula una API externa
// Lee datos de personal desde JSON (convertido del Excel LISTA_API_RB.xlsx)
// En producción sería reemplazado por llamadas HTTP a un servicio real.
// ---------------------------------------------------------------------------
const path = require('path')
const fs = require('fs')
const { query } = require('../../config/db')

const JSON_PATH = path.resolve(__dirname, '../../../data/personal-rrhh.json')

let _cache = null

function cargarDatos() {
  if (_cache) return _cache

  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

  _cache = raw.map((r) => ({
    dni:          String(r.DNI || '').padStart(8, '0'),
    apePaterno:   (r.APE_PATERNO || '').trim(),
    apeMaterno:   (r.APE_MATERNO || '').trim(),
    nombres:      (r.NOMBRE || '').trim(),
    apellidos:    `${(r.APE_PATERNO || '').trim()} ${(r.APE_MATERNO || '').trim()}`.trim(),
    tipoVinculo:  (r.TipoVinculo || '').trim(),
    cargo:        (r.CARGO || '').trim(),
    correo:       (r.CORREO || '').trim(),
    celular:      String(r.CELULAR || '').trim(),
    unidad:       (r.UNIDAD || '').trim(),
    sede:         (r.SEDE || '').trim(),
  }))

  console.log(`[externos] ${_cache.length} registros cargados desde JSON`)
  return _cache
}

function buscarPorDni(dni) {
  const datos = cargarDatos()
  const dniNorm = String(dni).padStart(8, '0')
  return datos.find((d) => d.dni === dniNorm) || null
}

function buscarPorNombre(texto) {
  const datos = cargarDatos()
  const q = (texto || '').toLowerCase().trim()
  if (!q) return []
  return datos.filter((d) => {
    const full = `${d.nombres} ${d.apellidos} ${d.dni}`.toLowerCase()
    return full.includes(q)
  }).slice(0, 20)
}

function listar({ limit = 20, offset = 0, search } = {}) {
  const datos = cargarDatos()
  let filtrados = datos

  if (search) {
    const q = search.toLowerCase().trim()
    filtrados = datos.filter((d) => {
      const full = `${d.nombres} ${d.apellidos} ${d.dni} ${d.unidad} ${d.sede}`.toLowerCase()
      return full.includes(q)
    })
  }

  return {
    total: filtrados.length,
    data: filtrados.slice(offset, offset + limit),
  }
}

function recargar() {
  _cache = null
  return cargarDatos()
}

function toDateInputValue(value) {
  if (!value) return null

  if (value instanceof Date) {
    return value.toISOString().split('T')[0]
  }

  const str = String(value)
  if (str.includes('T')) return str.split('T')[0]

  return str
}

function todayDateOnly() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function evaluarContrato(fechaFinContrato) {
  if (!fechaFinContrato) {
    return {
      contratoEstado: 'sin_fecha',
      puedeSolicitar: false,
      restricciones: ['El usuario no tiene fecha de fin de contrato registrada'],
    }
  }

  const fin = new Date(`${toDateInputValue(fechaFinContrato)}T00:00:00`)
  const hoy = todayDateOnly()

  if (Number.isNaN(fin.getTime())) {
    return {
      contratoEstado: 'sin_fecha',
      puedeSolicitar: false,
      restricciones: ['La fecha de fin de contrato no es válida'],
    }
  }

  if (fin < hoy) {
    return {
      contratoEstado: 'vencido',
      puedeSolicitar: false,
      restricciones: ['El contrato del usuario se encuentra vencido'],
    }
  }

  return {
    contratoEstado: 'vigente',
    puedeSolicitar: true,
    restricciones: [],
  }
}

async function obtenerServiciosAsignadosPorDni(dni) {
  const { rows } = await query(
    `
    WITH persona AS (
      SELECT id, dni, correo
        FROM personal
       WHERE dni = $1
       LIMIT 1
    ),

    servicios_individuales AS (
      SELECT DISTINCT sv.codigo
        FROM persona p
        JOIN solicitudes s ON s.id_solicitante = p.id
        JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
        JOIN servicios sv ON sv.id = ss.id_servicio
       WHERE s.estado = 'completada'
         AND ss.estado IN ('aprobado', 'atendido')
         AND sv.codigo IN ('c1', 'c4')
    ),

    servicios_masivos AS (
      SELECT DISTINCT item.codigo
        FROM persona p
        JOIN usuarios_masivos um ON um.dni = p.dni
        JOIN solicitudes s ON s.id = um.id_solicitud
        CROSS JOIN LATERAL jsonb_each(um.datos_servicios) AS item(codigo, data)
       WHERE s.tipo = 'masiva'
         AND s.estado = 'completada'
         AND item.codigo IN ('c1', 'c4')
         AND COALESCE(item.data->>'estado', '') IN ('aprobado', 'atendido')
    ),

    servicios AS (
      SELECT codigo FROM servicios_individuales
      UNION
      SELECT codigo FROM servicios_masivos
    )

    SELECT
      EXISTS (SELECT 1 FROM persona WHERE correo IS NOT NULL AND BTRIM(correo) <> '') AS tiene_correo,
      EXISTS (SELECT 1 FROM servicios WHERE codigo = 'c1') AS tiene_c1,
      EXISTS (SELECT 1 FROM servicios WHERE codigo = 'c4') AS tiene_c4
    `,
    [dni],
  )

  const row = rows[0] || {}

  return {
    tieneCorreoInstitucional: Boolean(row.tiene_correo),
    tieneC1Asignado: Boolean(row.tiene_c1),
    tieneVpnAsignada: Boolean(row.tiene_c4),
    serviciosAsignados: {
      c1: Boolean(row.tiene_c1),
      c4: Boolean(row.tiene_c4),
    },
  }
}

async function validarParaSolicitud(dni) {
  const dniNorm = String(dni || '').replace(/\D/g, '').padStart(8, '0')

  if (!/^\d{8}$/.test(dniNorm)) {
    return {
      dni: dniNorm,
      puedeSolicitar: false,
      contratoEstado: 'dni_invalido',
      restricciones: ['El DNI debe tener 8 dígitos'],
    }
  }

  const { rows } = await query(
    `SELECT p.id,
            p.dni,
            p.apellidos,
            p.nombres,
            p.tipo_vinculo,
            p.cargo,
            p.correo,
            p.telefono,
            p.oficina,
            p.fecha_inicio_contrato,
            p.fecha_fin_contrato,
            p.estado,
            s.nombre AS sede
       FROM personal p
       LEFT JOIN sedes s ON s.id = p.id_sede
      WHERE p.dni = $1
      LIMIT 1`,
    [dniNorm],
  )

  if (rows.length === 0) {
    const externo = buscarPorDni(dniNorm)

    return {
      dni: dniNorm,
      nombres: externo?.nombres || '',
      apellidos: externo?.apellidos || '',
      cargo: externo?.cargo || '',
      tipoVinculo: externo?.tipoVinculo || '',
      correo: externo?.correo || '',
      telefono: externo?.celular || '',
      oficina: externo?.unidad || '',
      sede: externo?.sede || '',
      fechaInicioContrato: null,
      fechaFinContrato: null,
      contratoEstado: 'sin_registro',
      puedeSolicitar: false,
      restricciones: [
        'El DNI no se encuentra registrado en el sistema SASI o no tiene contrato registrado',
      ],
    }
  }

  const row = rows[0]
  const contrato = evaluarContrato(row.fecha_fin_contrato)

  const serviciosActuales = await obtenerServiciosAsignadosPorDni(row.dni)

  const restricciones = [...contrato.restricciones]

  if (row.estado && String(row.estado).toLowerCase() !== 'activo') {
    restricciones.push(`El usuario se encuentra en estado ${row.estado}`)
  }

  const puedeSolicitar =
    contrato.puedeSolicitar &&
    (!row.estado || String(row.estado).toLowerCase() === 'activo')

  return {
    idPersonal: row.id,
    dni: row.dni,
    nombres: row.nombres,
    apellidos: row.apellidos,
    cargo: row.cargo,
    tipoVinculo: row.tipo_vinculo,
    correo: row.correo || '',
    telefono: row.telefono || '',
    oficina: row.oficina || '',
    sede: row.sede || '',
    fechaInicioContrato: toDateInputValue(row.fecha_inicio_contrato),
    fechaFinContrato: toDateInputValue(row.fecha_fin_contrato),
    estado: row.estado,
    contratoEstado: contrato.contratoEstado,
    puedeSolicitar,
    restricciones,

    tieneCorreoInstitucional: serviciosActuales.tieneCorreoInstitucional,
    tieneC1Asignado: serviciosActuales.tieneC1Asignado,
    tieneVpnAsignada: serviciosActuales.tieneVpnAsignada,
    serviciosAsignados: serviciosActuales.serviciosAsignados,
  }
}

module.exports = {
  buscarPorDni,
  buscarPorNombre,
  listar,
  recargar,
  validarParaSolicitud,
  obtenerServiciosAsignadosPorDni,
}