const { ok, error } = require('../../utils/response');
const { listarPorRol, decidir, atender } = require('./bandeja.queries');

const DECISIONES_VALIDAS = ['aprobar', 'observar', 'rechazar'];

/* ──────────────────────────────────────────────
   GET /bandeja — Lista ítems de la bandeja del usuario
   ────────────────────────────────────────────── */
async function listar(req, res) {
  try {
    const { roles } = req.user;

    if (!roles || roles.length === 0) {
      return ok(res, []);
    }

    const rows = await listarPorRol(roles);

    const items = rows.map((r) => ({
      id: r.etapa_id,
      solicitudId: r.solicitud_id,
      numero: r.numero,
      solicitante: r.solicitante,
      servicios: r.servicios_codigos,
      sede: r.sede,
      horasRestantes: r.horas_restantes_sla,
      slaHoras: r.sla_horas,
      vencioSla: r.vencio_sla,
      tipo: r.tipo,
    }));

    return ok(res, items);
  } catch (err) {
    console.error('bandeja.listar:', err);
    return error(res, 500, 'Error al obtener la bandeja de aprobación');
  }
}

/* ──────────────────────────────────────────────
   POST /bandeja/:id/decidir — Aprobar/Observar/Rechazar
   ────────────────────────────────────────────── */
async function decidirCtrl(req, res) {
  try {
    const etapaId = Number(req.params.id);
    const { decision, comentario } = req.body;

    // Validar decisión
    if (!DECISIONES_VALIDAS.includes(decision)) {
      return error(res, 400, `Decisión inválida. Valores permitidos: ${DECISIONES_VALIDAS.join(', ')}`);
    }

    // Validar comentario (obligatorio solo para observar y rechazar)
    if ((decision === 'observar' || decision === 'rechazar') && (!comentario || !comentario.trim())) {
      return error(res, 400, 'El comentario es obligatorio para observar o rechazar');
    }

    const resultado = await decidir(etapaId, decision, (comentario || '').trim(), req.user.id);

    return ok(res, resultado);
  } catch (err) {
    if (err.status) {
      return error(res, err.status, err.message);
    }
    console.error('bandeja.decidir:', err);
    return error(res, 500, 'Error al procesar la decisión');
  }
}

/* ──────────────────────────────────────────────
   POST /bandeja/:id/atender — Atender (provisionar) servicio
   ────────────────────────────────────────────── */
async function atenderCtrl(req, res) {
  try {
    const etapaId = Number(req.params.id);
    const { datosAtencion, comentario } = req.body;

    if (!datosAtencion || typeof datosAtencion !== 'object') {
      return error(res, 400, 'Los datos de atención son obligatorios');
    }

    const resultado = await atender(etapaId, datosAtencion, (comentario || '').trim(), req.user.id);

    return ok(res, resultado);
  } catch (err) {
    if (err.status) {
      return error(res, err.status, err.message);
    }
    console.error('bandeja.atender:', err);
    return error(res, 500, 'Error al procesar la atención');
  }
}

module.exports = { listar, decidir: decidirCtrl, atender: atenderCtrl };
