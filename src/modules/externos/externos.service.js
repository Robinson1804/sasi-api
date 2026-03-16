// ---------------------------------------------------------------------------
// externos.service.js — Servicio que simula una API externa
// Lee datos de personal desde JSON (convertido del Excel LISTA_API_RB.xlsx)
// En producción sería reemplazado por llamadas HTTP a un servicio real.
// ---------------------------------------------------------------------------
const path = require('path')
const fs = require('fs')

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

module.exports = { buscarPorDni, buscarPorNombre, listar, recargar }
