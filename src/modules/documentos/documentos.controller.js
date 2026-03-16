const path = require('path');
const fs   = require('fs');
const puppeteer = require('puppeteer');
const { ok, error } = require('../../utils/response');
const {
  registrarDocumento,
  obtenerPorId,
  actualizarPdfUrl,
  actualizarFirmadoUrl,
  limpiarFirmadoUrl,
  obtenerDatosSolicitud,
} = require('./documentos.queries');
const { generarHtmlSolicitud } = require('./pdf-template');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

/* ────────────────────────────────────────────────────────
 * POST /documentos/generar-pdf
 * Genera un documento PDF real a partir del template HTML
 * usando Puppeteer (Chromium headless).
 * ──────────────────────────────────────────────────────── */
async function generarPdf(req, res) {
  try {
    const { solicitudId } = req.body;
    if (!solicitudId) return error(res, 400, 'solicitudId es requerido');

    // Obtener datos de la solicitud
    const solicitud = await obtenerDatosSolicitud(solicitudId);
    if (!solicitud) return error(res, 404, 'Solicitud no encontrada');

    // Crear directorio de uploads si no existe
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    // Generar HTML y convertir a PDF con Puppeteer
    const htmlContent   = generarHtmlSolicitud(solicitud);
    const nombreArchivo = `solicitud_${solicitud.numero}_${Date.now()}.pdf`;
    const rutaArchivo   = path.join(UPLOAD_DIR, nombreArchivo);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: rutaArchivo,
      format: 'A4',
      margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
      printBackground: true,
    });
    await browser.close();

    const pdfUrl = `/uploads/${nombreArchivo}`;
    const stats  = fs.statSync(rutaArchivo);

    // Registrar en tabla documentos
    await registrarDocumento({
      id_solicitud:    solicitudId,
      tipo:            'solicitud_pdf',
      nombre_archivo:  nombreArchivo,
      url:             pdfUrl,
      tamano_bytes:    stats.size,
      id_usuario_subio: req.user.id,
    });

    // Actualizar pdf_url en solicitudes
    await actualizarPdfUrl(solicitudId, pdfUrl);

    return ok(res, { pdfUrl, numero: solicitud.numero });
  } catch (err) {
    console.error('documentos.generarPdf:', err);
    return error(res, 500, 'Error al generar PDF');
  }
}

/* ────────────────────────────────────────────────────────
 * POST /documentos/subir-firmado
 * Recibe un archivo firmado (PDF, JPG, PNG) via multer.
 * ──────────────────────────────────────────────────────── */
async function subirFirmado(req, res) {
  try {
    if (!req.file) return error(res, 400, 'No se recibio ningun archivo');

    const { solicitudId } = req.body;
    if (!solicitudId) return error(res, 400, 'solicitudId es requerido');

    const url            = `/uploads/${req.file.filename}`;
    const nombreArchivo  = req.file.filename;
    const tamanoBytes    = req.file.size;

    // Registrar en tabla documentos
    await registrarDocumento({
      id_solicitud:    solicitudId,
      tipo:            'firmado_usuario',
      nombre_archivo:  nombreArchivo,
      url,
      tamano_bytes:    tamanoBytes,
      id_usuario_subio: req.user.id,
    });

    // Actualizar firmado_url en solicitudes
    await actualizarFirmadoUrl(solicitudId, url);

    return ok(res, { url, nombreArchivo });
  } catch (err) {
    console.error('documentos.subirFirmado:', err);
    return error(res, 500, 'Error al subir archivo firmado');
  }
}

/* ────────────────────────────────────────────────────────
 * GET /documentos/:id/descargar
 * Descarga o redirige al documento solicitado.
 * ──────────────────────────────────────────────────────── */
async function descargar(req, res) {
  try {
    const doc = await obtenerPorId(req.params.id);
    if (!doc) return error(res, 404, 'Documento no encontrado');

    // Si la URL es local (/uploads/...), enviar el archivo con nombre descriptivo
    if (doc.url.startsWith('/uploads')) {
      const absolutePath = path.resolve(UPLOAD_DIR, path.basename(doc.url));
      if (!fs.existsSync(absolutePath)) {
        return error(res, 404, 'Archivo no encontrado en disco');
      }
      const ext = path.extname(doc.nombre_archivo) || '.pdf';
      const downloadName = doc.nombre_archivo || `documento${ext}`;
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      return res.sendFile(absolutePath);
    }

    // Si es una URL externa, redirigir
    return res.redirect(doc.url);
  } catch (err) {
    console.error('documentos.descargar:', err);
    return error(res, 500, 'Error al descargar documento');
  }
}

/* ────────────────────────────────────────────────────────
 * POST /documentos/eliminar-firmado
 * Limpia el firmado_url para permitir resubir.
 * ──────────────────────────────────────────────────────── */
async function eliminarFirmado(req, res) {
  try {
    const { solicitudId } = req.body;
    if (!solicitudId) return error(res, 400, 'solicitudId es requerido');
    await limpiarFirmadoUrl(solicitudId);
    return ok(res, { message: 'Documento firmado eliminado' });
  } catch (err) {
    console.error('documentos.eliminarFirmado:', err);
    return error(res, 500, 'Error al eliminar documento firmado');
  }
}

module.exports = { generarPdf, subirFirmado, eliminarFirmado, descargar };
