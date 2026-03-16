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
         ea.estado, ea.fecha_inicio
    FROM etapas_aprobacion ea
   WHERE ea.id = $1
     FOR UPDATE
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

const SQL_UPDATE_SOLICITUD = `
  UPDATE solicitudes SET estado = $1, fecha_cierre = $2 WHERE id = $3
`;

const SQL_INSERT_HISTORIAL = `
  INSERT INTO historial (id_solicitud, id_solicitud_servicio, tipo_evento, estado_nuevo, comentario, id_usuario)
  VALUES ($1, $2, $3, $4, $5, $6)
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
   Ahora opera a nivel de solicitud (flujo unificado)
   ────────────────────────────────────────────── */
async function decidir(etapaId, decision, comentario, aprobadorId) {
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

    // 3. Determinar nuevo estado
    const ESTADO_MAP = {
      aprobar: 'aprobado',
      observar: 'observado',
      rechazar: 'rechazado',
    };
    const nuevoEstado = ESTADO_MAP[decision];

    // Actualizar etapa
    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      nuevoEstado, aprobadorId, comentario, etapaId,
    ]);

    const solicitudId = etapa.id_solicitud;

    // Obtener numero de solicitud
    const { rows: [sol] } = await client.query(
      `SELECT numero FROM solicitudes WHERE id = $1`, [solicitudId]
    );

    // 4. Aprobar → avanzar flujo
    if (decision === 'aprobar') {
      const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
        solicitudId, etapa.orden,
      ]);

      if (nextEtapa) {
        // Activar siguiente etapa
        await client.query(SQL_ACTIVATE_ETAPA, [nextEtapa.id]);
      } else {
        // Última etapa → todos los servicios atendidos, solicitud completada
        await client.query(SQL_UPDATE_ALL_SERVICIOS, ['atendido', solicitudId]);
        await client.query(SQL_UPDATE_SOLICITUD, ['completada', new Date(), solicitudId]);
      }
    }

    // 5. Rechazar → cerrar solicitud y servicios
    if (decision === 'rechazar') {
      await client.query(SQL_UPDATE_ALL_SERVICIOS, ['rechazado', solicitudId]);
      await client.query(SQL_UPDATE_SOLICITUD, ['rechazada', new Date(), solicitudId]);
    }

    // 6. Observar → marcar solicitud y servicios como observada
    if (decision === 'observar') {
      await client.query(SQL_UPDATE_ALL_SERVICIOS, ['observado', solicitudId]);
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
      null, // ya no es por servicio individual
      TIPO_EVENTO_MAP[decision],
      nuevoEstado,
      comentario,
      aprobadorId,
    ]);

    await client.query('COMMIT');

    return {
      etapa: etapaActualizada,
      solicitudId,
      numero: sol?.numero,
      decision,
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
async function atender(etapaId, datosAtencion, comentario, aprobadorId) {
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
        `UPDATE solicitud_servicios SET datos_atencion = $1, estado = 'atendido', updated_at = NOW() WHERE id = $2`,
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
