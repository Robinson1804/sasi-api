const { query, getClient } = require('../../config/db');

/* ──────────────────────────────────────────────
   SQL — Listar bandeja por rol(es) del usuario
   ────────────────────────────────────────────── */
const SQL_LISTAR_POR_ROL = `
  WITH max_etapas AS (
    SELECT id_solicitud, MAX(orden) AS max_orden
      FROM etapas_aprobacion
     GROUP BY id_solicitud
  )
  SELECT
         v.etapa_id,
         v.solicitud_id,
         v.numero,
         v.solicitante,
         v.sede,
         v.tipo,
         v.id_rol,
         v.rol_codigo,
         v.rol_nombre,
         v.etapa_estado,
         v.fecha_inicio,
         v.sla_horas,
         v.horas_transcurridas,
         v.vencio_sla,
         v.servicios_codigos,
         v.horas_restantes_sla,
         ea.orden,
         me.max_orden,
         CASE
           WHEN v.rol_codigo = 'soporte_tecnico' AND ea.orden = 0 THEN 'validacion'
           WHEN v.rol_codigo = 'soporte_tecnico' AND ea.orden = me.max_orden THEN 'cierre'
           ELSE 'revision'
         END AS categoria,
         CASE
           WHEN v.rol_codigo = 'soporte_tecnico' AND ea.orden = 0 THEN 'Validación inicial'
           WHEN v.rol_codigo = 'soporte_tecnico' AND ea.orden = me.max_orden THEN 'Cierre técnico'
           ELSE 'Revisión pendiente'
         END AS categoria_label
    FROM v_bandeja_aprobacion v
    JOIN etapas_aprobacion ea ON ea.id = v.etapa_id
    JOIN max_etapas me ON me.id_solicitud = v.solicitud_id
   WHERE v.rol_codigo = ANY($1)
     AND v.etapa_estado IN ('pendiente', 'en_revision')
   ORDER BY v.fecha_inicio ASC
`;

const SQL_LISTAR_OBSERVADAS_SOPORTE = `
  SELECT
         s.id AS etapa_id,
         s.id AS solicitud_id,
         s.numero,
         s.snap_nombres AS solicitante,
         s.snap_sede AS sede,
         s.tipo,
         NULL::int AS id_rol,
         'soporte_tecnico' AS rol_codigo,
         'Soporte Técnico' AS rol_nombre,
         s.estado AS etapa_estado,
         s.updated_at AS fecha_inicio,
         NULL::numeric AS sla_horas,
         NULL::numeric AS horas_transcurridas,
         false AS vencio_sla,
         COALESCE(
           array_agg(DISTINCT sv.codigo ORDER BY sv.codigo)
             FILTER (WHERE sv.codigo IS NOT NULL),
           ARRAY[]::varchar[]
         ) AS servicios_codigos,
         NULL::numeric AS horas_restantes_sla,
         NULL::smallint AS orden,
         NULL::smallint AS max_orden,
         'observada' AS categoria,
         'Observada' AS categoria_label
    FROM solicitudes s
    LEFT JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
    LEFT JOIN servicios sv ON sv.id = ss.id_servicio
   WHERE s.estado = 'observada'
     AND s.id_solicitud_padre IS NULL
   GROUP BY s.id
   ORDER BY s.updated_at DESC
`;

const SQL_LISTAR_RECHAZADAS_SOPORTE = `
  SELECT
         s.id AS etapa_id,
         s.id AS solicitud_id,
         s.numero,
         s.snap_nombres AS solicitante,
         s.snap_sede AS sede,
         s.tipo,
         NULL::int AS id_rol,
         'soporte_tecnico' AS rol_codigo,
         'Soporte Técnico' AS rol_nombre,
         s.estado AS etapa_estado,
         s.updated_at AS fecha_inicio,
         NULL::numeric AS sla_horas,
         NULL::numeric AS horas_transcurridas,
         false AS vencio_sla,
         COALESCE(
           array_agg(DISTINCT sv.codigo ORDER BY sv.codigo)
             FILTER (WHERE sv.codigo IS NOT NULL),
           ARRAY[]::varchar[]
         ) AS servicios_codigos,
         NULL::numeric AS horas_restantes_sla,
         NULL::smallint AS orden,
         NULL::smallint AS max_orden,
         'rechazada' AS categoria,
         'Rechazada' AS categoria_label
    FROM solicitudes s
    LEFT JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
    LEFT JOIN servicios sv ON sv.id = ss.id_servicio
   WHERE s.estado = 'rechazada'
     AND s.id_solicitud_padre IS NULL
   GROUP BY s.id
   ORDER BY s.updated_at DESC
`;

/* ──────────────────────────────────────────────
   SQL — Helpers transaccionales
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
     SET estado              = $1,
         id_aprobador        = $2,
         comentario          = $3,
         fecha_accion        = NOW(),
         horas_transcurridas = EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600,
         vencio_sla          = CASE
                                  WHEN EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600 > sla_horas
                                  THEN true
                                  ELSE false
                                END
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
     SET estado = 'en_revision',
         fecha_inicio = NOW()
   WHERE id = $1
`;

const SQL_UPDATE_ALL_SERVICIOS = `
  UPDATE solicitud_servicios
     SET estado = $1,
         updated_at = NOW()
   WHERE id_solicitud = $2
`;

const SQL_UPDATE_SERVICIO_ESTADO = `
  UPDATE solicitud_servicios ss
     SET estado = $1,
         updated_at = NOW()
    FROM servicios sv
   WHERE ss.id_servicio = sv.id
     AND ss.id_solicitud = $2
     AND sv.codigo = $3
`;

const SQL_UPDATE_SOLICITUD = `
  UPDATE solicitudes
     SET estado = $1,
         fecha_cierre = $2
   WHERE id = $3
`;

const SQL_INSERT_HISTORIAL = `
  INSERT INTO historial (
    id_solicitud,
    id_solicitud_servicio,
    tipo_evento,
    estado_nuevo,
    comentario,
    id_usuario
  )
  VALUES ($1, $2::int, $3, $4, $5, $6)
`;

const SQL_GET_SERVICIOS_SOLICITUD = `
  SELECT
    sv.codigo,
    ss.datos,
    ss.datos_atencion
  FROM solicitud_servicios ss
  JOIN servicios sv ON sv.id = ss.id_servicio
  WHERE ss.id_solicitud = $1
    AND sv.codigo = ANY($2)
`;

const SQL_UPDATE_CORREO_SOLICITANTE = `
  UPDATE personal p
     SET correo = $2,
         updated_at = NOW()
    FROM solicitudes s
   WHERE s.id = $1
     AND p.id = s.id_solicitante
     AND s.tipo = 'individual'
     AND (p.correo IS NULL OR TRIM(p.correo) = '')
  RETURNING p.id, p.correo
`;

const SQL_GET_SOLICITUD_FOR_UPDATE = `
  SELECT id, numero, tipo, estado
    FROM solicitudes
   WHERE id = $1
   FOR UPDATE
`;

const SQL_GET_USUARIOS_MASIVOS_FOR_UPDATE = `
  SELECT *
    FROM usuarios_masivos
   WHERE id_solicitud = $1
   ORDER BY id
   FOR UPDATE
`;

const SQL_UPDATE_USUARIO_MASIVO_DATOS_SERVICIOS = `
  UPDATE usuarios_masivos
     SET datos_servicios = $1::jsonb
   WHERE id = $2
`;

const SQL_GET_PERSONAL_BY_DNI_FOR_UPDATE = `
  SELECT id, dni, nombres, apellidos, correo, telefono
    FROM personal
   WHERE dni = $1
   FOR UPDATE
`;

const SQL_GET_PERSONAL_BY_CORREO = `
  SELECT id, dni, nombres, apellidos, correo
    FROM personal
   WHERE LOWER(TRIM(correo)) = LOWER(TRIM($1))
     AND dni <> $2
   LIMIT 1
`;

const SQL_UPDATE_PERSONAL_CORREO_BY_DNI = `
  UPDATE personal
     SET correo = $2,
         updated_at = NOW()
   WHERE dni = $1
  RETURNING id, dni, correo
`;

/* ──────────────────────────────────────────────
   Helpers JS
   ────────────────────────────────────────────── */
function normalizeJson(value, fallback) {
  if (!value) return fallback;

  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const ESTADOS_NO_CONTINUAN = new Set(['observado', 'rechazado']);

function getEstadoServicioMasivo(datosServicios, codigo) {
  const data = datosServicios?.[codigo];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  return String(data.estado || '').trim();
}

function getServiciosSolicitadosUsuario(row) {
  const servicios = normalizeJson(row.servicios_solicitados, []);
  const datosServicios = normalizeJson(row.datos_servicios, {});

  const codigosBase =
    Array.isArray(servicios) && servicios.length > 0
      ? servicios.filter((codigo) => ['c1', 'c4'].includes(codigo))
      : Object.keys(datosServicios).filter((codigo) => ['c1', 'c4'].includes(codigo));

  return codigosBase.filter((codigo) => {
    const estado = getEstadoServicioMasivo(datosServicios, codigo);

    // Si ya fue observado o rechazado en una etapa anterior,
    // no debe continuar a las siguientes etapas.
    return !ESTADOS_NO_CONTINUAN.has(estado);
  });
}

function getNombreUsuarioMasivo(row) {
  return `${row.nombres || ''} ${row.apellidos || ''}`.trim() || row.dni || `Usuario ${row.id}`;
}

function flattenDecisionesMasivas(usuariosMasivosDecisiones) {
  return usuariosMasivosDecisiones.flatMap((usuarioDecision) =>
    usuarioDecision.servicios.map((servicioDecision) => ({
      usuarioMasivoId: usuarioDecision.usuarioMasivoId || null,
      dni: usuarioDecision.dni || null,
      codigo: servicioDecision.codigo,
      decision: servicioDecision.decision,
      comentario: servicioDecision.comentario || '',
      datosAtencion: servicioDecision.datosAtencion || {},
    })),
  );
}

function derivarDecisionGlobal(decisiones) {
  const hayAprobados = decisiones.some((d) => d.decision === 'aprobar');
  const hayObservados = decisiones.some((d) => d.decision === 'observar');
  const hayRechazados = decisiones.some((d) => d.decision === 'rechazar');

  // En grupales, un rechazo u observación parcial no debe detener
  // a los usuarios-servicio que sí fueron aprobados.
  if (hayAprobados) return 'aprobar';

  if (hayObservados) return 'observar';

  if (hayRechazados) return 'rechazar';

  return 'observar';
}

function estadoFromDecision(decision) {
  const map = {
    aprobar: 'aprobado',
    observar: 'observado',
    rechazar: 'rechazado',
  };

  return map[decision] || 'observado';
}

function calcularResumenMasivo(decisiones) {
  const resumen = {
    aprobados: 0,
    observados: 0,
    rechazados: 0,
  };

  for (const d of decisiones) {
    if (d.decision === 'aprobar') resumen.aprobados += 1;
    if (d.decision === 'observar') resumen.observados += 1;
    if (d.decision === 'rechazar') resumen.rechazados += 1;
  }

  return resumen;
}

function buildComentarioResumenMasivo(decisiones, rolCodigo) {
  const resumen = calcularResumenMasivo(decisiones);

  return [
    `Revisión masiva registrada por ${rolCodigo}`,
    `Aprobados: ${resumen.aprobados}`,
    `Observados: ${resumen.observados}`,
    `Rechazados: ${resumen.rechazados}`,
  ].join(' | ');
}

function buildComentarioMasivo(decisiones, rolCodigo) {
  const comentariosDetalle = decisiones
    .filter((d) => String(d.comentario || '').trim())
    .map((d) => {
      const usuario = d.dni || d.usuarioMasivoId || 'usuario';
      return `${usuario} ${String(d.codigo).toUpperCase()}: ${String(d.comentario).trim()}`;
    });

  const resumen = buildComentarioResumenMasivo(decisiones, rolCodigo);

  if (comentariosDetalle.length === 0) {
    return resumen;
  }

  return `${resumen} | ${comentariosDetalle.join(' | ')}`;
}

function mergeDecisionEnDatosServicio({
  datosServicios,
  codigo,
  estadoServicio,
  decision,
  comentario,
  datosAtencion,
  rolCodigo,
  aprobadorId,
}) {
  const baseServicio =
    datosServicios[codigo] &&
    typeof datosServicios[codigo] === 'object' &&
    !Array.isArray(datosServicios[codigo])
      ? datosServicios[codigo]
      : {};

  const revisiones =
    baseServicio.revisiones &&
    typeof baseServicio.revisiones === 'object' &&
    !Array.isArray(baseServicio.revisiones)
      ? baseServicio.revisiones
      : {};

  const datosAtencionPrevios =
    baseServicio.datosAtencion &&
    typeof baseServicio.datosAtencion === 'object' &&
    !Array.isArray(baseServicio.datosAtencion)
      ? baseServicio.datosAtencion
      : {};

  return {
    ...datosServicios,
    [codigo]: {
      ...baseServicio,
      estado: estadoServicio,
      decision,
      comentario: comentario || '',
      datosAtencion: {
        ...datosAtencionPrevios,
        ...(datosAtencion || {}),
      },
      revisiones: {
        ...revisiones,
        [rolCodigo]: {
          decision,
          estado: estadoServicio,
          comentario: comentario || '',
          datosAtencion: datosAtencion || {},
          idAprobador: aprobadorId,
          fecha: new Date().toISOString(),
        },
      },
    },
  };
}

function agruparEstadoPorServicio(decisiones) {
  const porServicio = new Map();

  for (const decision of decisiones) {
    const codigo = decision.codigo;

    if (!porServicio.has(codigo)) {
      porServicio.set(codigo, []);
    }

    porServicio.get(codigo).push(decision.decision);
  }

  return Array.from(porServicio.entries()).map(([codigo, decisionesServicio]) => {
    const hayAprobados = decisionesServicio.includes('aprobar');
    const hayObservados = decisionesServicio.includes('observar');
    const hayRechazados = decisionesServicio.includes('rechazar');

    let decisionAgregada = 'aprobar';

    if (hayAprobados) {
      decisionAgregada = 'aprobar';
    } else if (hayObservados) {
      decisionAgregada = 'observar';
    } else if (hayRechazados) {
      decisionAgregada = 'rechazar';
    }

    return {
      codigo,
      estado: estadoFromDecision(decisionAgregada),
    };
  });
}

function getCorreoCreadoFromDecision(sd) {
  const datosAtencion = sd.datosAtencion || {};

  return String(datosAtencion.correoCreado || '').trim();
}

async function actualizarCorreoPerfilMasivo({
  client,
  usuario,
  sd,
  aprobadorId,
  solicitudId,
}) {
  if (sd.codigo !== 'c1') return;
  if (sd.decision !== 'aprobar') return;

  const correoCreado = getCorreoCreadoFromDecision(sd);

  if (!correoCreado) return;

  const dni = String(usuario.dni || '').trim();

  if (!dni) {
    throw {
      status: 400,
      message: 'No se puede actualizar correo: el usuario masivo no tiene DNI',
    };
  }

  const { rows: [personal] } = await client.query(
    SQL_GET_PERSONAL_BY_DNI_FOR_UPDATE,
    [dni],
  );

  if (!personal) {
    throw {
      status: 400,
      message: `No se encontró personal con DNI ${dni} para actualizar correo institucional`,
    };
  }

  const { rows: [duplicado] } = await client.query(
    SQL_GET_PERSONAL_BY_CORREO,
    [correoCreado, dni],
  );

  if (duplicado) {
    throw {
      status: 409,
      message: `El correo ${correoCreado} ya está registrado para otro usuario (${duplicado.dni})`,
    };
  }

  const correoActual = String(personal.correo || '').trim();

  if (correoActual && correoActual.toLowerCase() !== correoCreado.toLowerCase()) {
    throw {
      status: 409,
      message: `El usuario ${dni} ya tiene correo institucional registrado (${correoActual}). No se sobrescribió con ${correoCreado}`,
    };
  }

  if (correoActual.toLowerCase() === correoCreado.toLowerCase()) {
    return;
  }

  const { rows: actualizados } = await client.query(
    SQL_UPDATE_PERSONAL_CORREO_BY_DNI,
    [dni, correoCreado],
  );

  if (actualizados.length > 0) {
    await client.query(SQL_INSERT_HISTORIAL, [
      solicitudId,
      null,
      'APROBACION',
      'correo_actualizado',
      `Correo institucional actualizado en perfil para DNI ${dni}: ${correoCreado}`,
      aprobadorId,
    ]);
  }
}

/* ──────────────────────────────────────────────
   listarPorRol
   ────────────────────────────────────────────── */
async function listarPorRol(roles) {
  const { rows } = await query(SQL_LISTAR_POR_ROL, [roles]);

  if (!roles.includes('soporte_tecnico')) {
    return rows;
  }

  const { rows: observadas } = await query(SQL_LISTAR_OBSERVADAS_SOPORTE);
  const { rows: rechazadas } = await query(SQL_LISTAR_RECHAZADAS_SOPORTE);

  const existentes = new Set(rows.map((r) => Number(r.solicitud_id)));

  const observadasSinDuplicar = observadas.filter(
    (r) => !existentes.has(Number(r.solicitud_id)),
  );

  const existentesConObservadas = new Set([
    ...rows.map((r) => Number(r.solicitud_id)),
    ...observadasSinDuplicar.map((r) => Number(r.solicitud_id)),
  ]);

  const rechazadasSinDuplicar = rechazadas.filter(
    (r) => !existentesConObservadas.has(Number(r.solicitud_id)),
  );

  return [
    ...rows,
    ...observadasSinDuplicar,
    ...rechazadasSinDuplicar,
  ];
}

/* ──────────────────────────────────────────────
   decidir — Flujo individual
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
  let overallDecision = 'aprobar';

  for (const sd of servicioDecisiones) {
    if (sd.decision === 'rechazar') {
      overallDecision = 'rechazar';
      break;
    }

    if (sd.decision === 'observar') {
      overallDecision = 'observar';
    }
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    const { rows: [etapa] } = await client.query(SQL_GET_ETAPA, [etapaId]);

    if (!etapa) {
      throw { status: 404, message: 'Etapa no encontrada' };
    }

    if (!['pendiente', 'en_revision'].includes(etapa.estado)) {
      throw {
        status: 409,
        message: `La etapa ya fue procesada (estado: ${etapa.estado})`,
      };
    }

    if (rolesUsuario.length > 0 && !rolesUsuario.includes(etapa.rol_codigo)) {
      throw {
        status: 403,
        message: `No tiene permisos para actuar en esta etapa (rol requerido: ${etapa.rol_codigo})`,
      };
    }

    const ESTADO_MAP = {
      aprobar: 'aprobado',
      observar: 'observado',
      rechazar: 'rechazado',
    };

    const nuevoEstado = ESTADO_MAP[overallDecision];

    const comentarioEtapa =
      comentarioGeneral ||
      servicioDecisiones
        .filter((sd) => sd.comentario?.trim())
        .map((sd) => `${sd.codigo.toUpperCase()}: ${sd.comentario.trim()}`)
        .join(' | ') ||
      '';

    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      nuevoEstado,
      aprobadorId,
      comentarioEtapa,
      etapaId,
    ]);

    const solicitudId = etapa.id_solicitud;

    const codigosDecision = servicioDecisiones.map((sd) => sd.codigo);

    const { rows: serviciosDecision } = await client.query(
      SQL_GET_SERVICIOS_SOLICITUD,
      [solicitudId, codigosDecision],
    );

    const servicioPorCodigo = new Map(
      serviciosDecision.map((s) => [s.codigo, s]),
    );

    const decisionC1 = servicioDecisiones.find((sd) => sd.codigo === 'c1');
    const servicioC1 = servicioPorCodigo.get('c1');

    const esC1Creacion =
      Boolean(decisionC1) &&
      servicioC1?.datos?.tipoOperacion === 'creacion';

    const c1AprobadoCreacion =
      esC1Creacion &&
      decisionC1?.decision === 'aprobar';

    if (
      etapa.rol_codigo === 'seguridad_accesos' &&
      c1AprobadoCreacion &&
      !String(usuarioRedAsignado || '').trim()
    ) {
      throw {
        status: 400,
        message: 'Debe registrar el usuario de red asignado para C1 creación',
      };
    }

    if (
      etapa.rol_codigo === 'equipo_redes' &&
      c1AprobadoCreacion
    ) {
      const datosC1 = datosAtencion?.c1 || {};
      const usuarioRedCreado = String(datosC1.usuarioRedCreado || '').trim();
      const correoCreado = String(datosC1.correoCreado || '').trim();
      const perfilInternet = String(datosC1.perfilInternet || '').trim();

      if (!usuarioRedCreado) {
        throw {
          status: 400,
          message: 'Redes debe confirmar el usuario de red creado',
        };
      }

      if (!correoCreado) {
        throw {
          status: 400,
          message: 'Redes debe registrar el correo institucional asociado',
        };
      }

      if (!perfilInternet) {
        throw {
          status: 400,
          message: 'Redes debe confirmar el perfil de internet asignado',
        };
      }

      datosAtencion.c1 = {
        ...datosC1,
        capacidadCorreo: datosC1.capacidadCorreo || '100 MB',
      };

      const { rows: correoActualizadoRows } = await client.query(
        SQL_UPDATE_CORREO_SOLICITANTE,
        [solicitudId, correoCreado],
      );

      if (correoActualizadoRows.length > 0) {
        await client.query(SQL_INSERT_HISTORIAL, [
          solicitudId,
          null,
          'APROBACION',
          'correo_actualizado',
          `Correo institucional actualizado en perfil: ${correoCreado}`,
          aprobadorId,
        ]);
      }
    }

    if (
      overallDecision === 'aprobar' &&
      datosAtencion &&
      typeof datosAtencion === 'object'
    ) {
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

    const { rows: [sol] } = await client.query(
      `SELECT numero FROM solicitudes WHERE id = $1`,
      [solicitudId],
    );

    if (overallDecision === 'aprobar') {
      const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
        solicitudId,
        etapa.orden,
      ]);

      if (nextEtapa) {
        await client.query(SQL_ACTIVATE_ETAPA, [nextEtapa.id]);
      } else {
        await client.query(SQL_UPDATE_ALL_SERVICIOS, ['atendido', solicitudId]);
        await client.query(SQL_UPDATE_SOLICITUD, [
          'completada',
          new Date(),
          solicitudId,
        ]);
      }
    }

    if (
      overallDecision === 'aprobar' &&
      etapa.rol_codigo === 'seguridad_accesos' &&
      usuarioRedAsignado
    ) {
      await client.query(
        `UPDATE solicitud_servicios ss
            SET datos_atencion = COALESCE(ss.datos_atencion, '{}'::jsonb)
                              || jsonb_build_object('usuarioRedAsignado', $1::text),
                updated_at = NOW()
          FROM servicios sv
          WHERE ss.id_servicio = sv.id
            AND ss.id_solicitud = $2
            AND sv.codigo = 'c1'`,
        [usuarioRedAsignado, solicitudId],
      );
    }

    if (overallDecision === 'rechazar') {
      await client.query(SQL_UPDATE_ALL_SERVICIOS, ['rechazado', solicitudId]);
      await client.query(SQL_UPDATE_SOLICITUD, [
        'rechazada',
        new Date(),
        solicitudId,
      ]);
    }

    if (overallDecision === 'observar') {
      for (const sd of servicioDecisiones) {
        const estadoServicio = ESTADO_MAP[sd.decision] || 'observado';

        await client.query(SQL_UPDATE_SERVICIO_ESTADO, [
          estadoServicio,
          solicitudId,
          sd.codigo,
        ]);
      }

      await client.query(SQL_UPDATE_SOLICITUD, [
        'observada',
        null,
        solicitudId,
      ]);
    }

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
   decidirMasiva — Flujo grupal por usuario-servicio
   ────────────────────────────────────────────── */
async function decidirMasiva(
  etapaId,
  usuariosMasivosDecisiones,
  aprobadorId,
  rolesUsuario = [],
) {
  const decisiones = flattenDecisionesMasivas(usuariosMasivosDecisiones);

  if (decisiones.length === 0) {
    throw {
      status: 400,
      message: 'Debe enviar al menos una decisión por usuario-servicio',
    };
  }

  const overallDecision = derivarDecisionGlobal(decisiones);
  const nuevoEstado = estadoFromDecision(overallDecision);

  const client = await getClient();

  try {
    await client.query('BEGIN');

    const { rows: [etapa] } = await client.query(SQL_GET_ETAPA, [etapaId]);

    if (!etapa) {
      throw { status: 404, message: 'Etapa no encontrada' };
    }

    if (!['pendiente', 'en_revision'].includes(etapa.estado)) {
      throw {
        status: 409,
        message: `La etapa ya fue procesada (estado: ${etapa.estado})`,
      };
    }

    if (rolesUsuario.length > 0 && !rolesUsuario.includes(etapa.rol_codigo)) {
      throw {
        status: 403,
        message: `No tiene permisos para actuar en esta etapa (rol requerido: ${etapa.rol_codigo})`,
      };
    }

    const solicitudId = etapa.id_solicitud;

    const { rows: [solicitud] } = await client.query(
      SQL_GET_SOLICITUD_FOR_UPDATE,
      [solicitudId],
    );

    if (!solicitud) {
      throw { status: 404, message: 'Solicitud no encontrada' };
    }

    if (solicitud.tipo !== 'masiva') {
      throw {
        status: 400,
        message: 'Este flujo masivo solo aplica a solicitudes grupales',
      };
    }

    const { rows: usuariosMasivos } = await client.query(
      SQL_GET_USUARIOS_MASIVOS_FOR_UPDATE,
      [solicitudId],
    );

    if (usuariosMasivos.length === 0) {
      throw {
        status: 400,
        message: 'La solicitud grupal no tiene usuarios asociados',
      };
    }

    const usuariosPorId = new Map(
      usuariosMasivos.map((u) => [Number(u.id), u]),
    );

    const usuariosPorDni = new Map(
      usuariosMasivos.map((u) => [String(u.dni), u]),
    );

    const decisionesPorUsuario = new Map();

    for (const usuarioDecision of usuariosMasivosDecisiones) {
      const usuario = usuarioDecision.usuarioMasivoId
        ? usuariosPorId.get(Number(usuarioDecision.usuarioMasivoId))
        : usuariosPorDni.get(String(usuarioDecision.dni));

      if (!usuario) {
        throw {
          status: 400,
          message: `Usuario masivo no encontrado en esta solicitud: ${usuarioDecision.dni || usuarioDecision.usuarioMasivoId}`,
        };
      }

      const serviciosSolicitados = getServiciosSolicitadosUsuario(usuario);
      const serviciosDecision = usuarioDecision.servicios || [];

      for (const sd of serviciosDecision) {
        if (!serviciosSolicitados.includes(sd.codigo)) {
          throw {
            status: 400,
            message: `${getNombreUsuarioMasivo(usuario)} no solicitó el servicio ${String(sd.codigo).toUpperCase()}`,
          };
        }
      }

      decisionesPorUsuario.set(Number(usuario.id), {
        usuario,
        servicios: serviciosDecision,
      });
    }

    for (const usuario of usuariosMasivos) {
      const serviciosSolicitados = getServiciosSolicitadosUsuario(usuario);

      // Si el usuario ya no tiene servicios activos porque todos fueron
      // observados o rechazados en una etapa anterior, no debe exigirse decisión.
      if (serviciosSolicitados.length === 0) {
        continue;
      }

      const decisionesUsuario = decisionesPorUsuario.get(Number(usuario.id));

      if (!decisionesUsuario) {
        throw {
          status: 400,
          message: `Faltan decisiones para ${getNombreUsuarioMasivo(usuario)}`,
        };
      }

      const codigosDecididos = new Set(
        decisionesUsuario.servicios.map((sd) => sd.codigo),
      );

      for (const codigo of serviciosSolicitados) {
        if (!codigosDecididos.has(codigo)) {
          throw {
            status: 400,
            message: `Falta decisión para ${getNombreUsuarioMasivo(usuario)} - ${String(codigo).toUpperCase()}`,
          };
        }
      }
    }

    const comentarioEtapa = buildComentarioMasivo(
      decisiones,
      etapa.rol_codigo,
    );

    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      nuevoEstado,
      aprobadorId,
      comentarioEtapa,
      etapaId,
    ]);

    for (const { usuario, servicios } of decisionesPorUsuario.values()) {
      let datosServicios = normalizeJson(usuario.datos_servicios, {});

      for (const sd of servicios) {
        const estadoServicio = estadoFromDecision(sd.decision);

        datosServicios = mergeDecisionEnDatosServicio({
          datosServicios,
          codigo: sd.codigo,
          estadoServicio,
          decision: sd.decision,
          comentario: sd.comentario || '',
          datosAtencion: sd.datosAtencion || {},
          rolCodigo: etapa.rol_codigo,
          aprobadorId,
        });

        await actualizarCorreoPerfilMasivo({
          client,
          usuario,
          sd,
          aprobadorId,
          solicitudId,
        });
      }

      await client.query(SQL_UPDATE_USUARIO_MASIVO_DATOS_SERVICIOS, [
        JSON.stringify(datosServicios),
        usuario.id,
      ]);
    }

    for (const servicioEstado of agruparEstadoPorServicio(decisiones)) {
      await client.query(SQL_UPDATE_SERVICIO_ESTADO, [
        servicioEstado.estado,
        solicitudId,
        servicioEstado.codigo,
      ]);
    }

    if (overallDecision === 'aprobar') {
      const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
        solicitudId,
        etapa.orden,
      ]);

      if (nextEtapa) {
        await client.query(SQL_ACTIVATE_ETAPA, [nextEtapa.id]);
        await client.query(SQL_UPDATE_SOLICITUD, [
          'en_proceso',
          null,
          solicitudId,
        ]);
      } else {
        await client.query(SQL_UPDATE_ALL_SERVICIOS, [
          'atendido',
          solicitudId,
        ]);

        await client.query(SQL_UPDATE_SOLICITUD, [
          'completada',
          new Date(),
          solicitudId,
        ]);
      }
    }

    if (overallDecision === 'observar') {
      await client.query(SQL_UPDATE_SOLICITUD, [
        'observada',
        null,
        solicitudId,
      ]);
    }

    if (overallDecision === 'rechazar') {
      await client.query(SQL_UPDATE_ALL_SERVICIOS, [
        'rechazado',
        solicitudId,
      ]);

      await client.query(SQL_UPDATE_SOLICITUD, [
        'rechazada',
        new Date(),
        solicitudId,
      ]);
    }

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
      numero: solicitud.numero,
      decision: overallDecision,
      modo: 'masiva',
      resumen: calcularResumenMasivo(decisiones),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────
   atender — Transacción de atención técnica individual
   ────────────────────────────────────────────── */
async function atender(etapaId, datosAtencion, comentario, aprobadorId, rolesUsuario = []) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const { rows: [etapa] } = await client.query(SQL_GET_ETAPA, [etapaId]);

    if (!etapa) {
      throw { status: 404, message: 'Etapa no encontrada' };
    }

    if (!['pendiente', 'en_revision'].includes(etapa.estado)) {
      throw {
        status: 409,
        message: `La etapa ya fue procesada (estado: ${etapa.estado})`,
      };
    }

    if (rolesUsuario.length > 0 && !rolesUsuario.includes(etapa.rol_codigo)) {
      throw {
        status: 403,
        message: `No tiene permisos para actuar en esta etapa (rol requerido: ${etapa.rol_codigo})`,
      };
    }

    const { rows: [nextEtapa] } = await client.query(SQL_NEXT_ETAPA, [
      etapa.id_solicitud,
      etapa.orden,
    ]);

    if (nextEtapa) {
      throw {
        status: 400,
        message: 'Solo se puede atender en la última etapa del flujo',
      };
    }

    const { rows: [etapaActualizada] } = await client.query(SQL_UPDATE_ETAPA, [
      'aprobado',
      aprobadorId,
      comentario || 'Servicio atendido',
      etapaId,
    ]);

    const solicitudId = etapa.id_solicitud;

    const { rows: ssRows } = await client.query(
      `SELECT ss.id, sv.codigo
         FROM solicitud_servicios ss
         JOIN servicios sv ON sv.id = ss.id_servicio
        WHERE ss.id_solicitud = $1`,
      [solicitudId],
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

    await client.query(SQL_UPDATE_SOLICITUD, [
      'completada',
      new Date(),
      solicitudId,
    ]);

    const { rows: [sol] } = await client.query(
      `SELECT numero FROM solicitudes WHERE id = $1`,
      [solicitudId],
    );

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

module.exports = {
  listarPorRol,
  decidir,
  decidirMasiva,
  atender,
};