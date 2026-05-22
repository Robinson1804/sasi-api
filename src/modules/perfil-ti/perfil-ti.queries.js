const { query } = require('../../config/db')

// Servicios asignados: de solicitudes completadas/atendidas del usuario
const SQL_SERVICIOS_ASIGNADOS = `
  SELECT DISTINCT ON (sv.codigo)
         sv.codigo, sv.nombre, sv.icono, sv.color,
         ss.estado AS estado_servicio,
         ss.datos,
         s.fecha_creacion
    FROM solicitud_servicios ss
    JOIN solicitudes s ON ss.id_solicitud = s.id
    JOIN servicios sv ON ss.id_servicio = sv.id
   WHERE s.id_solicitante = $1
     AND ss.estado IN ('atendido', 'aprobado')
   ORDER BY sv.codigo, s.fecha_creacion DESC
`

async function obtenerServiciosAsignados(idPersonal) {
  const { rows } = await query(SQL_SERVICIOS_ASIGNADOS, [idPersonal])
  return rows
}

// Estadísticas de solicitudes del usuario
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

module.exports = {
  obtenerServiciosAsignados,
  obtenerEstadisticas,
  actualizarTelefono,
}