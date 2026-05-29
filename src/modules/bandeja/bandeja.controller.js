const { ok, error } = require('../../utils/response');
const { listarPorRol, decidir, decidirMasiva, atender } = require('./bandeja.queries');

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
      etapaNombre: r.rol_nombre,
      etapaEstado: r.etapa_estado,
      categoria: r.categoria,
      categoriaLabel: r.categoria_label,
    }));

    return ok(res, items);
  } catch (err) {
    console.error('bandeja.listar:', err);
    return error(res, 500, 'Error al obtener la bandeja de aprobación');
  }
}

/* ──────────────────────────────────────────────
   POST /bandeja/:id/decidir

   Flujo individual:
   {
     servicioDecisiones: [{ codigo, decision, comentario }],
     usuarioRedAsignado?,
     datosAtencion?
   }

   Flujo masivo:
   {
     usuariosMasivosDecisiones: [
       {
         usuarioMasivoId?,
         dni?,
         servicios: [
           {
             codigo,
             decision,
             comentario?,
             datosAtencion?
           }
         ]
       }
     ]
   }
   ────────────────────────────────────────────── */
async function decidirCtrl(req, res) {
  try {
    const etapaId = Number(req.params.id);

    const {
      servicioDecisiones,
      usuariosMasivosDecisiones,
      usuarioRedAsignado,
      datosAtencion,
    } = req.body;

    if (!Number.isInteger(etapaId) || etapaId <= 0) {
      return error(res, 400, 'ID de etapa inválido');
    }

    const tieneDecisionesMasivas =
      Array.isArray(usuariosMasivosDecisiones) &&
      usuariosMasivosDecisiones.length > 0;

    if (tieneDecisionesMasivas) {
      for (const usuarioDecision of usuariosMasivosDecisiones) {
        if (!usuarioDecision.usuarioMasivoId && !usuarioDecision.dni) {
          return error(
            res,
            400,
            'Cada decisión masiva debe incluir usuarioMasivoId o dni',
          );
        }

        if (
          !Array.isArray(usuarioDecision.servicios) ||
          usuarioDecision.servicios.length === 0
        ) {
          return error(
            res,
            400,
            'Cada usuario debe incluir decisiones por servicio',
          );
        }

        for (const sd of usuarioDecision.servicios) {
          if (!sd.codigo || typeof sd.codigo !== 'string') {
            return error(
              res,
              400,
              'Cada decisión debe incluir el código de servicio',
            );
          }

          if (!DECISIONES_VALIDAS.includes(sd.decision)) {
            return error(
              res,
              400,
              `Decisión inválida para ${sd.codigo}: "${sd.decision}". Valores permitidos: ${DECISIONES_VALIDAS.join(', ')}`,
            );
          }

          if (
            (sd.decision === 'observar' || sd.decision === 'rechazar') &&
            !sd.comentario?.trim()
          ) {
            return error(
              res,
              400,
              `El comentario es obligatorio para observar o rechazar (usuario: ${usuarioDecision.dni || usuarioDecision.usuarioMasivoId}, servicio: ${sd.codigo})`,
            );
          }
        }
      }
    } else {
      if (!Array.isArray(servicioDecisiones) || servicioDecisiones.length === 0) {
        return error(
          res,
          400,
          'Se requieren las decisiones por servicio (servicioDecisiones)',
        );
      }

      for (const sd of servicioDecisiones) {
        if (!sd.codigo || typeof sd.codigo !== 'string') {
          return error(
            res,
            400,
            'Cada decisión debe incluir el código de servicio',
          );
        }

        if (!DECISIONES_VALIDAS.includes(sd.decision)) {
          return error(
            res,
            400,
            `Decisión inválida para ${sd.codigo}: "${sd.decision}". Valores permitidos: ${DECISIONES_VALIDAS.join(', ')}`,
          );
        }

        if (
          (sd.decision === 'observar' || sd.decision === 'rechazar') &&
          !sd.comentario?.trim()
        ) {
          return error(
            res,
            400,
            `El comentario es obligatorio para observar o rechazar (servicio: ${sd.codigo})`,
          );
        }
      }
    }

    const datosAtencionValidos =
      datosAtencion && typeof datosAtencion === 'object' && !Array.isArray(datosAtencion)
        ? datosAtencion
        : {};

    const resultado = tieneDecisionesMasivas
      ? await decidirMasiva(
          etapaId,
          usuariosMasivosDecisiones,
          req.user.id,
          req.user.roles || [],
        )
      : await decidir(
          etapaId,
          servicioDecisiones,
          null,
          req.user.id,
          (usuarioRedAsignado || '').trim() || null,
          req.user.roles || [],
          datosAtencionValidos,
        );

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
   POST /bandeja/:id/atender — Atender cierre técnico
   ────────────────────────────────────────────── */
async function atenderCtrl(req, res) {
  try {
    const etapaId = Number(req.params.id);
    const { datosAtencion, comentario } = req.body;

    if (!Number.isInteger(etapaId) || etapaId <= 0) {
      return error(res, 400, 'ID de etapa inválido');
    }

    if (!datosAtencion || typeof datosAtencion !== 'object' || Array.isArray(datosAtencion)) {
      return error(res, 400, 'Los datos de atención son obligatorios');
    }

    const resultado = await atender(
      etapaId,
      datosAtencion,
      (comentario || '').trim(),
      req.user.id,
      req.user.roles || [],
    );

    return ok(res, resultado);
  } catch (err) {
    if (err.status) {
      return error(res, err.status, err.message);
    }

    console.error('bandeja.atender:', err);
    return error(res, 500, 'Error al procesar la atención');
  }
}

module.exports = {
  listar,
  decidir: decidirCtrl,
  atender: atenderCtrl,
};