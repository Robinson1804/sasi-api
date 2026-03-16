const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const { verifyToken } = require('../../middleware/auth');
const ctrl    = require('./documentos.controller');

/* ── Multer config ──────────────────────────────────────── */

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `firmado_${req.body.solicitudId || 'unknown'}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

/* ── Rutas ──────────────────────────────────────────────── */

router.use(verifyToken);

router.post('/generar-pdf',       ctrl.generarPdf);
router.post('/subir-firmado',     upload.single('archivo'), ctrl.subirFirmado);
router.post('/eliminar-firmado',  ctrl.eliminarFirmado);
router.get('/:id/descargar',      ctrl.descargar);

module.exports = router;
