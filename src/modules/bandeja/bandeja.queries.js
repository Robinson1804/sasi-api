const { query, getClient } = require('../../config/db');

/* ──────────────────────────────────────────────
   SQL — Listar bandeja por rol(es) del usuario
   ────────────────────────────────────────────── */
const SQL_LISTAR_POR_ROL = `
  SELECT etapa_id, solicitud_id, numero, solicitante, sede,
         tipo, id_rol, rol_codigo, rol_nombre, etapa_estado,
         fecha_inicio, sla_horas, horas_transcurridas,
         vencio_sla, servicios_codigos, horas_restantes_sla
    FROM v_bandeja_aprobacion
   WHERE rol_codigo = ANY($1)
     AND etapa_estado IN ('pendiente', 'en_revision')
   ORDER BY horas_restantes_sla ASC
`;

/* ──────────────────────────────────────────────
   SQL — Helpers usados dentro de la transacción
   ────────────────────────────────────────────── */
const SQL_GET_ETAPA = `
  SELECT ea.id, ea.id_solicitud, ea.orden, ea.id_rol,
         ea.estado, ea.fecha_inicio, r.codigo AS rol_codigo
    FROM etapas_aprobacion ea
    JOIN roles r ON r.id = ea.id_rol
   WHERE ea.id = $1
     FOR UPDATE OF ea
`;

const SQL_UPDATE_ETAPA = `
  UPDATE etapas_aprobacion
     SET estado            = $1,
         id_aprobador      = $2,
         comentario        = $3,
         fecha_accion      = NOW(),
         horas_transcurridas = EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600,
         vencio_sla        = CASE WHEN EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600 > sla_horas THEN true ELSE false END
   WHERE id = $4
   RETURNING *
`;

const SQL_NEXT_ETAPA = `
  SELECT id, orden
    FROM etapas_aprobacion
   WHERE id_solicitud = $1
     AND orden > $2
   ORDER BY orden ASC
   LIMIT 1
`;

const SQL_ACTIVATE_ETAPA = `
  UPDATE etapas_aprobacion
     SET estado = 'en_revision', fecha_inicio = NOW()
   WHERE id = $1
`;

const SQL_UPDATE_ALL_SERVICIOS = `
  UPDATE solicitud_servicios SET estado = $1, updated_at = NOW()
   WHERE id_solicitud = $2
`;

const SQL_UPDATE_SERVICIO_ESTADO = `
  UPDATE solicitud_servicios ss
     SET estado = $1, updated_at = NOW()
    FROM servicios sv
   WHERE ss.id_servicio = sv.id
     AND ss.id_solicitud = $2
     AND sv.codigo = $3
`;

const SQL_UPDATE_SOLICITUD = `
  UPDATE solicitudes SET estado = $1, fecha_cierre = $2 WHERE id = $3
`;

const SQL_INSERT_HISTORIAL = `
  INSERT INTO historial (id_solicitud, id_solicitud_servicio, tipo_evento, estado_nuevo, comentario, id_usuario)
  VALUES ($1, $2::int, $3, $4, $5, $6)
`;

/* ──────────────────────────────────────────────
   listarPorRol
   ────────────────────────────────────────────── */
async function listarPorRol(roles) {
  const { rows } = await query(SQL_LISTAR_POR_ROL, [roles]);
  return rows;
}

/* ──────────────────────────────────────────────
   decidir — Transacción de aprobación/observación/rechazo
   Acepta decisiones por servicio: [{ codigo, decision, comentario }]
   La decisión global se deriva: rechazar > observar > aprobar
   ────────────────────────────────────────────── */
  async function decidir(
    etapaId,
    servicioDecisiones,
    comentarioGeneral,
    aprobadorId,
    usuarioRedAsignado = null,
    rolesUsuario = [],
    datosAtencion = {},
  ) {
    // Derivar decisión global: rechazar > observar > aprobar
  let overallDecision = 'aprobar';
  for (const sd of servicioDecisiones) {
    if (sd.decision === 'rechazar') { overallDecision = 'rechazar'; break; }
    if (sd.decision === 'observar') overallDecision = 'observar';
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Obtener la etapa (con lock)
    const { rows: [etapa] } = await client.query(SQL_GET_ETAPA, [etapaId]);
    if (!etapa) {
      throw { status: 404, message: 'Etapa no encontrada' };
    }

    // 2. Validar estado
    if (!['pendiente', 'en_revision'].includes(etapa.estado)) {
      throw { status: 409, message: `La etapa ya fue procesada (estado: ${etapa.estado})` };
    }

    // 2b. Validar que el usuario tiene el rol correcto para esta etapa
    if (rolesUsuario.length > 0 && !rolesUsuario.includes(etapa.rol_codigo)) {
      throw { status: 403, message: `No tiene permisos para actuar en esta etapa (rol requerido: ${etapa.rol_codigo})` };
    }

    // 3. Determinar nuevo estado global
    const ESTADO_MAP = {
      aprobar: 'aprobado',
      observar: 'observado',
      rechazar: 'rechazado',
    };
    const nuevoEstado = ESTADO_MAP[overallDecision];

    // Armar comentario consolidado (nunca null — algunas columnas tienen NOT NULL)
    const comentarioEtapa = comentarioGeneral ||
      servicioDecisiones
        .filter(sd => sd.comentario?.trim())
        .map(sd => `${sd.codigo.toUpperCase()}: ${sd.comentario.trim()}`)
        .join(' | ') ||
      '';

    // Actualizar etapa con decisión global
    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      nuevoEstado, aprobadorId, comentarioEtapa, etapaId,
    ]);

    const solicitudId = etapa.id_solicitud;

        // Guardar datos técnicos en etapas intermedias.
        // Ejemplo: Redes registra equipoDesbloqueado, fechaDesbloqueo, correoCreado, etc.
        // El cierre final de Soporte seguirá usando atender().
        if (overallDecision === 'aprobar' && datosAtencion && typeof datosAtencion === 'object') {
          const codigosConDatos = Object.keys(datosAtencion).filter((codigo) => {
            const data = datosAtencion[codigo];

            return data &&
              typeof data === 'object' &&
              !Array.isArray(data) &&
              Object.values(data).some((v) => String(v || '').trim());
          });

          for (const codigo of codigosConDatos) {
            await client.query(
              `UPDATE solicitud_servicios ss
                  SET datos_atencion = COALESCE(ss.datos_atencion, '{}'::jsonb) || $1::jsonb,
                      updated_at = NOW()
                FROM servicios sv
                WHERE ss.id_servicio = sv.id
                  AND ss.id_solicitud = $2
                  AND sv.codigo = $3`,
              [JSON.stringify(datosAtencion[codigo]), solicitudId, codigo],
            );
          }
        }

    // Obtener numero de solicitud
    const { rows: [sol] } = await client.query(
      `SELECT numero FROM solicitudes WHERE id = $1`, [solicitudId]
    );

    // 4. Aprobar → avanzar flujo
    if (overallDecision === 'aprobar') {
      const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
        solicitudId, etapa.orden,
      ]);

      if (nextEtapa) {
        // Activar siguiente etapa (servicios quedan en pendiente hasta final)
        await client.query(SQL_ACTIVATE_ETAPA, [nextEtapa.id]);
      } else {
        // Última etapa → todos los servicios atendidos, solicitud completada
        await client.query(SQL_UPDATE_ALL_SERVICIOS, ['atendido', solicitudId]);
        await client.query(SQL_UPDATE_SOLICITUD, ['completada', new Date(), solicitudId]);
      }
    }

    // 4b. Si es aprobación con usuarioRedAsignado → pre-cargar datos_atencion del servicio C1
    if (overallDecision === 'aprobar' && usuarioRedAsignado) {
      await client.query(
        `UPDATE solicitud_servicios ss
            SET datos_atencion = COALESCE(ss.datos_atencion, '{}'::jsonb)
                              || jsonb_build_object('usuarioRedCreado', $1::text),
                updated_at = NOW()
           FROM servicios sv
          WHERE ss.id_servicio = sv.id
            AND ss.id_solicitud = $2
            AND sv.codigo = 'c1'`,
        [usuarioRedAsignado, solicitudId],
      );
    }

    // 5. Rechazar → cerrar solicitud y todos los servicios
    if (overallDecision === 'rechazar') {
      await client.query(SQL_UPDATE_ALL_SERVICIOS, ['rechazado', solicitudId]);
      await client.query(SQL_UPDATE_SOLICITUD, ['rechazada', new Date(), solicitudId]);
    }

    // 6. Observar → actualizar cada servicio con su decisión individual
    if (overallDecision === 'observar') {
      for (const sd of servicioDecisiones) {
        const estadoServicio = ESTADO_MAP[sd.decision] || 'observado';
        await client.query(SQL_UPDATE_SERVICIO_ESTADO, [estadoServicio, solicitudId, sd.codigo]);
      }
      await client.query(SQL_UPDATE_SOLICITUD, ['observada', null, solicitudId]);
    }

    // 7. Historial
    const TIPO_EVENTO_MAP = {
      aprobar: 'APROBACION',
      observar: 'OBSERVACION',
      rechazar: 'RECHAZO',
    };

    await client.query(SQL_INSERT_HISTORIAL, [
      solicitudId,
      null,
      TIPO_EVENTO_MAP[overallDecision],
      nuevoEstado,
      comentarioEtapa,
      aprobadorId,
    ]);

    await client.query('COMMIT');

    return {
      etapa: etapaActualizada,
      solicitudId,
      numero: sol?.numero,
      decision: overallDecision,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────
   atender — Transacción de atención técnica (última etapa)
   Guarda datos de aprovisionamiento y marca TODOS los servicios como atendidos
   ────────────────────────────────────────────── */
async function atender(etapaId, datosAtencion, comentario, aprobadorId, rolesUsuario = []) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Obtener la etapa (con lock)
    const { rows: [etapa] } = await client.query(SQL_GET_ETAPA, [etapaId]);
    if (!etapa) {
      throw { status: 404, message: 'Etapa no encontrada' };
    }

    // 2. Validar estado
    if (!['pendiente', 'en_revision'].includes(etapa.estado)) {
      throw { status: 409, message: `La etapa ya fue procesada (estado: ${etapa.estado})` };
    }

    // 2b. Validar rol
    if (rolesUsuario.length > 0 && !rolesUsuario.includes(etapa.rol_codigo)) {
      throw { status: 403, message: `No tiene permisos para actuar en esta etapa (rol requerido: ${etapa.rol_codigo})` };
    }

    // 3. Verificar que es la última etapa
    const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
      etapa.id_solicitud, etapa.orden,
    ]);
    if (nextEtapa) {
      throw { status: 400, message: 'Solo se puede atender en la última etapa del flujo' };
    }

    // 4. Actualizar etapa como aprobado
    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      'aprobado', aprobadorId, comentario || 'Servicio atendido', etapaId,
    ]);

    const solicitudId = etapa.id_solicitud;

    // 5. Guardar datos_atencion en cada solicitud_servicio según su código
    // datosAtencion viene como { c1: { campo: valor }, c4: { campo: valor } }
    const { rows: ssRows } = await client.query(
      `SELECT ss.id, sv.codigo
         FROM solicitud_servicios ss
         JOIN servicios sv ON sv.id = ss.id_servicio
        WHERE ss.id_solicitud = $1`,
      [solicitudId]
    );

    for (const ss of ssRows) {
      const srvData = datosAtencion[ss.codigo] || {};
      await client.query(
        `UPDATE solicitud_servicios
            SET datos_atencion = COALESCE(datos_atencion, '{}'::jsonb) || $1::jsonb,
                estado = 'atendido',
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(srvData), ss.id],
      );
    }

    // 6. Marcar solicitud como completada
    await client.query(SQL_UPDATE_SOLICITUD, ['completada', new Date(), solicitudId]);

    // 7. Obtener numero
    const { rows: [sol] } = await client.query(
      `SELECT numero FROM solicitudes WHERE id = $1`, [solicitudId]
    );

    // 8. Historial
    await client.query(SQL_INSERT_HISTORIAL, [
      solicitudId,
      null,
      'ATENCION',
      'atendido',
      comentario || 'Servicio aprovisionado por el equipo técnico',
      aprobadorId,
    ]);

    await client.query('COMMIT');

    return {
      etapa: etapaActualizada,
      solicitudId,
      numero: sol?.numero,
      decision: 'atender',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listarPorRol, decidir, atender };
