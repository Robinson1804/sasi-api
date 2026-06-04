const { query } = require('../../config/db')

// Servicios asignados: solicitudes individuales + solicitudes grupales donde el usuario fue beneficiario.
const SQL_SERVICIOS_ASIGNADOS = `
  WITH persona AS (
    SELECT id, dni
      FROM personal
     WHERE id = $1
  ),

  servicios_individuales AS (
    SELECT
           sv.codigo,
           sv.nombre,
           sv.icono,
           sv.color,
           ss.estado AS estado_servicio,
           ss.datos,
           ss.datos_atencion,
           s.fecha_creacion
      FROM persona p
      JOIN solicitudes s ON s.id_solicitante = p.id
      JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
      JOIN servicios sv ON ss.id_servicio = sv.id
     WHERE ss.estado IN ('atendido', 'aprobado')
       AND s.estado IN ('completada', 'en_proceso')
  ),

  servicios_masivos AS (
    SELECT
           sv.codigo,
           sv.nombre,
           sv.icono,
           sv.color,
           COALESCE(
             um.datos_servicios->sv.codigo->>'estado',
             'aprobado'
           ) AS estado_servicio,
           um.datos_servicios->sv.codigo AS datos,
           um.datos_servicios->sv.codigo->'datosAtencion' AS datos_atencion,
           s.fecha_creacion
      FROM persona p
      JOIN usuarios_masivos um ON um.dni = p.dni
      JOIN solicitudes s ON s.id = um.id_solicitud
      JOIN servicios sv ON sv.codigo IN ('c1', 'c4')
     WHERE s.tipo = 'masiva'
       AND s.estado = 'completada'
       AND um.datos_servicios ? sv.codigo
       AND COALESCE(um.datos_servicios->sv.codigo->>'estado', '') IN ('aprobado', 'atendido')
  ),

  servicios_unificados AS (
    SELECT * FROM servicios_individuales
    UNION ALL
    SELECT * FROM servicios_masivos
  )

  SELECT DISTINCT ON (codigo)
         codigo,
         nombre,
         icono,
         color,
         estado_servicio,
         datos,
         datos_atencion,
         fecha_creacion
    FROM servicios_unificados
   ORDER BY codigo, fecha_creacion DESC
`

async function obtenerServiciosAsignados(idPersonal) {
  const { rows } = await query(SQL_SERVICIOS_ASIGNADOS, [idPersonal])
  return rows
}

const SQL_ESTADISTICAS = `
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE estado = 'completada') AS completadas,
    COUNT(*) FILTER (WHERE estado IN ('en_proceso', 'enviada')) AS en_proceso,
    COUNT(*) FILTER (WHERE estado = 'rechazada') AS rechazadas
  FROM solicitudes
  WHERE id_solicitante = $1
    AND id_solicitud_padre IS NULL
`

async function obtenerEstadisticas(idPersonal) {
  const { rows } = await query(SQL_ESTADISTICAS, [idPersonal])
  return rows[0]
}

async function actualizarTelefono(idPersonal, telefono) {
  const { rows } = await query(
    `UPDATE personal
        SET telefono = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING telefono`,
    [idPersonal, telefono],
  )

  return rows[0]
}

async function actualizarCorreoPersonal(idPersonal, correoPersonal) {
  const { rows } = await query(
    `UPDATE personal
        SET correo_personal = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING correo_personal`,
    [idPersonal, correoPersonal],
  )

  return rows[0]
}

module.exports = {
  obtenerServiciosAsignados,
  obtenerEstadisticas,
  actualizarTelefono,
  actualizarCorreoPersonal,
}