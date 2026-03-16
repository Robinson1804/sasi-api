const { query } = require('../../config/db');

/* ── INSERT ─────────────────────────────────────────────── */

const SQL_INSERT = `
  INSERT INTO documentos (id_solicitud, tipo, nombre_archivo, url, tamano_bytes, id_usuario_subio)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING *
`;

async function registrarDocumento(data) {
  const { id_solicitud, tipo, nombre_archivo, url, tamano_bytes, id_usuario_subio } = data;
  const { rows } = await query(SQL_INSERT, [
    id_solicitud, tipo, nombre_archivo, url, tamano_bytes, id_usuario_subio,
  ]);
  return rows[0];
}

/* ── SELECT ─────────────────────────────────────────────── */

const SQL_POR_ID = `SELECT * FROM documentos WHERE id = $1`;

async function obtenerPorId(id) {
  const { rows } = await query(SQL_POR_ID, [id]);
  return rows[0] || null;
}

const SQL_POR_SOLICITUD = `
  SELECT * FROM documentos
   WHERE id_solicitud = $1
   ORDER BY created_at DESC
`;

async function obtenerPorSolicitud(idSolicitud) {
  const { rows } = await query(SQL_POR_SOLICITUD, [idSolicitud]);
  return rows;
}

/* ── UPDATE solicitudes URLs ────────────────────────────── */

const SQL_UPDATE_PDF = `UPDATE solicitudes SET pdf_url = $2 WHERE id = $1`;

async function actualizarPdfUrl(solicitudId, pdfUrl) {
  await query(SQL_UPDATE_PDF, [solicitudId, pdfUrl]);
}

const SQL_UPDATE_FIRMADO = `UPDATE solicitudes SET firmado_url = $2 WHERE id = $1`;

async function actualizarFirmadoUrl(solicitudId, firmadoUrl) {
  await query(SQL_UPDATE_FIRMADO, [solicitudId, firmadoUrl]);
}

/* ── Auxiliar: datos de solicitud para PDF ──────────────── */

const SQL_SOLICITUD_DATOS = `
  SELECT s.id, s.numero, s.tipo,
         COALESCE(s.snap_nombres, p.nombres || ' ' || p.apellidos) AS snap_nombres,
         COALESCE(s.snap_dni, p.dni) AS snap_dni,
         COALESCE(s.snap_cargo, p.cargo) AS snap_cargo,
         COALESCE(s.snap_vinculo, p.tipo_vinculo) AS snap_vinculo,
         COALESCE(s.snap_sede, se.nombre) AS snap_sede,
         COALESCE(s.snap_oficina, p.oficina) AS snap_oficina,
         COALESCE(s.snap_correo, p.correo) AS snap_correo,
         s.estado, s.fecha_creacion,
         json_agg(json_build_object(
           'codigo', sv.codigo,
           'nombre', sv.nombre,
           'icono', sv.icono,
           'datos', ss.datos
         )) AS servicios
    FROM solicitudes s
    LEFT JOIN personal p             ON p.id = s.id_solicitante
    LEFT JOIN sedes se               ON se.id = p.id_sede
    LEFT JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
    LEFT JOIN servicios sv           ON sv.id = ss.id_servicio
   WHERE s.id = $1
   GROUP BY s.id, p.nombres, p.apellidos, p.dni, p.cargo, p.tipo_vinculo, se.nombre, p.oficina, p.correo
`;

const SQL_USUARIOS_MASIVOS = `
  SELECT dni, nombres, apellidos, cargo, internet_perfil,
         correo_personal, telefono_contacto, nombre_host,
         tipo_cuenta, correo_institucional
    FROM usuarios_masivos
   WHERE id_solicitud = $1
   ORDER BY id
`;

async function obtenerDatosSolicitud(solicitudId) {
  const { rows } = await query(SQL_SOLICITUD_DATOS, [solicitudId]);
  const sol = rows[0] || null;
  if (sol && sol.tipo === 'masiva') {
    const { rows: umRows } = await query(SQL_USUARIOS_MASIVOS, [solicitudId]);
    sol.usuarios_masivos = umRows;
  }
  return sol;
}

async function limpiarFirmadoUrl(solicitudId) {
  await query(`UPDATE solicitudes SET firmado_url = NULL WHERE id = $1`, [solicitudId]);
}

module.exports = {
  registrarDocumento,
  obtenerPorId,
  obtenerPorSolicitud,
  actualizarPdfUrl,
  actualizarFirmadoUrl,
  limpiarFirmadoUrl,
  obtenerDatosSolicitud,
};
