// ---------------------------------------------------------------------------
// solicitudes.helpers.js — Mapeo snake_case → camelCase
// ---------------------------------------------------------------------------

/**
 * Convierte una fila de la tabla solicitudes (snake_case) al formato
 * camelCase que espera el frontend.
 */
function mapSolicitudRow(row) {
  if (!row) return null
  return {
    id:                 row.id,
    numero:             row.numero,
    estado:             row.estado,
    tipo:               row.tipo,
    fechaCreacion:      row.fecha_creacion,
    fechaEnvio:         row.fecha_envio,
    fechaCierre:        row.fecha_cierre,
    snapNombres:        row.snap_nombres,
    snapDni:            row.snap_dni,
    snapCargo:          row.snap_cargo,
    snapVinculo:        row.snap_vinculo,
    snapCorreo:         row.snap_correo,
    snapTelefono:       row.snap_telefono,
    snapOficina:        row.snap_oficina,
    snapSede:           row.snap_sede,
    motivoCancelacion:  row.motivo_cancelacion,
    // Campos que provienen de JOINs opcionales (documentos)
    pdfUrl:             row.pdf_url   || null,
    firmadoUrl:         row.firmado_url || null,
    // Servicios agregados (si la query lo incluye)
    servicios:          row.servicios || undefined,
  }
}

module.exports = { mapSolicitudRow }
