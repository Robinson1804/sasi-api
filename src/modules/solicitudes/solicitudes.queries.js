// ---------------------------------------------------------------------------
// solicitudes.queries.js — Consultas de base de datos para Solicitudes
// ---------------------------------------------------------------------------
const { query, getClient } = require('../../config/db')

// ============================= LISTAR ======================================

async function listar(filters = {}) {
  const {
    estado, servicio, sede, periodo, search,
    idSolicitante, limit = 20, offset = 0,
  } = filters

  const conditions = []
  const params = []
  let idx = 1

  // Solo solicitudes principales (no hijas de masiva)
  conditions.push('s.id NOT IN (SELECT id FROM solicitudes WHERE numero LIKE \'%-H%\')')
  // Nota: si se implementa id_solicitud_padre, cambiar a:
  // conditions.push('s.id_solicitud_padre IS NULL')

  if (estado) {
    conditions.push(`s.estado = $${idx++}`)
    params.push(estado)
  }

  if (servicio) {
    conditions.push(`EXISTS (
      SELECT 1 FROM solicitud_servicios ss2
      JOIN servicios sv2 ON sv2.id = ss2.id_servicio
      WHERE ss2.id_solicitud = s.id AND sv2.codigo = $${idx++}
    )`)
    params.push(servicio)
  }

  if (sede) {
    conditions.push(`s.snap_sede ILIKE $${idx++}`)
    params.push(`%${sede}%`)
  }

  if (periodo) {
    const periodoMap = {
      ultimo_mes:       "NOW() - INTERVAL '1 month'",
      ultimos_3_meses:  "NOW() - INTERVAL '3 months'",
      este_año:         "DATE_TRUNC('year', NOW())",
    }
    const expr = periodoMap[periodo]
    if (expr) {
      conditions.push(`s.fecha_creacion >= ${expr}`)
    }
  }

  if (search) {
    conditions.push(`(
      s.numero ILIKE $${idx} OR
      s.snap_dni ILIKE $${idx} OR
      s.snap_nombres ILIKE $${idx}
    )`)
    params.push(`%${search}%`)
    idx++
  }

  if (idSolicitante) {
    conditions.push(`s.id_solicitante = $${idx++}`)
    params.push(idSolicitante)
  }

  const where = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : ''

  // Contar total
  const countSql = `SELECT COUNT(*) AS total FROM solicitudes s ${where}`
  const { rows: countRows } = await query(countSql, params)
  const total = parseInt(countRows[0].total, 10)

  // Traer solicitudes con servicios agregados
  const dataSql = `
    SELECT s.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'codigo', sv.codigo,
                 'nombre', sv.nombre,
                 'icono',  sv.icono,
                 'color',  sv.color,
                 'estado', ss.estado
               )
             ) FILTER (WHERE sv.id IS NOT NULL),
             '[]'
           ) AS servicios
      FROM solicitudes s
      LEFT JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
      LEFT JOIN servicios sv           ON sv.id = ss.id_servicio
      ${where}
     GROUP BY s.id
     ORDER BY s.fecha_creacion DESC
     LIMIT $${idx++} OFFSET $${idx++}
  `
  params.push(limit, offset)

  const { rows } = await query(dataSql, params)

  return { rows, total }
}

// ========================== OBTENER POR ID =================================

async function obtenerPorId(id) {
  // 1. Solicitud base
  const { rows: solRows } = await query(
    `SELECT s.*,
            s.pdf_url    AS pdf_url,
            s.firmado_url AS firmado_url
       FROM solicitudes s
      WHERE s.id = $1`,
    [id]
  )
  if (solRows.length === 0) return null
  const solicitud = solRows[0]

  // 2. Servicios
  const { rows: servicios } = await query(
    `SELECT ss.id,
            json_build_object(
              'id',     sv.id,
              'codigo', sv.codigo,
              'nombre', sv.nombre,
              'icono',  sv.icono,
              'color',  sv.color
            ) AS servicio,
            ss.estado,
            ss.datos,
            ss.datos_atencion
       FROM solicitud_servicios ss
       JOIN servicios sv ON sv.id = ss.id_servicio
      WHERE ss.id_solicitud = $1
      ORDER BY sv.orden`,
    [id]
  )

  // 3. Etapas de aprobacion (flujo unificado por solicitud)
  const { rows: etapaRows } = await query(
    `SELECT ea.id,
            ea.orden,
            r.nombre   AS rol_nombre,
            ea.estado,
            CASE WHEN ua.id IS NOT NULL
              THEN CONCAT(pa.nombres, ' ', pa.apellidos)
              ELSE NULL
            END AS aprobador_nombre,
            ea.comentario,
            ea.fecha_inicio,
            ea.fecha_accion,
            ea.horas_transcurridas,
            ea.vencio_sla,
            COALESCE(ea.sla_horas, cf.sla_horas) AS sla_horas
       FROM etapas_aprobacion ea
       JOIN roles r            ON r.id  = ea.id_rol
       LEFT JOIN config_flujo cf ON cf.id = ea.id_config
       LEFT JOIN usuarios ua   ON ua.id = ea.id_aprobador
       LEFT JOIN personal pa   ON pa.id = ua.id_personal
      WHERE ea.id_solicitud = $1
      ORDER BY ea.orden`,
    [id]
  )
  const etapas = etapaRows.map(e => ({
    id:                   e.id,
    orden:                e.orden,
    rolNombre:            e.rol_nombre,
    estado:               e.estado,
    aprobadorNombre:      e.aprobador_nombre,
    comentario:           e.comentario,
    fechaInicio:          e.fecha_inicio,
    fechaAccion:          e.fecha_accion,
    horasTranscurridas:   e.horas_transcurridas,
    vencioSla:            e.vencio_sla,
    slaHoras:             e.sla_horas,
  }))

  // 4. Historial
  const { rows: historialRows } = await query(
    `SELECT h.id,
            h.tipo_evento,
            h.estado_nuevo,
            h.comentario,
            CASE WHEN u.id IS NOT NULL
              THEN CONCAT(p.nombres, ' ', p.apellidos)
              ELSE 'Sistema'
            END AS usuario_nombre,
            h.created_at
       FROM historial h
       LEFT JOIN usuarios u ON u.id = h.id_usuario
       LEFT JOIN personal p ON p.id = u.id_personal
      WHERE h.id_solicitud = $1
      ORDER BY h.created_at ASC`,
    [id]
  )
  const historial = historialRows.map(h => ({
    id:           h.id,
    tipoEvento:   h.tipo_evento,
    estadoNuevo:  h.estado_nuevo,
    comentario:   h.comentario,
    usuarioNombre: h.usuario_nombre,
    createdAt:    h.created_at,
  }))

  // 5. Si es masiva: hijas
  let solicitudesHijas = []
  if (solicitud.tipo === 'masiva') {
    // Convension: hijas se generan con numero SASI-YYYY-NNNNNN-H01, H02...
    // y comparten el mismo id_personal o se guardan en usuarios_masivos
    const { rows: hijasRows } = await query(
      `SELECT s2.id, s2.numero, s2.snap_nombres AS nombre_usuario,
              s2.snap_dni AS dni, s2.estado
         FROM solicitudes s2
        WHERE s2.numero LIKE $1 || '-H%'
        ORDER BY s2.numero`,
      [solicitud.numero]
    )
    solicitudesHijas = hijasRows
  }

  // 6. Usuarios masivos (si existe la tabla)
  let usuariosMasivos = []
  try {
    const { rows: umRows } = await query(
      `SELECT * FROM usuarios_masivos WHERE id_solicitud = $1 ORDER BY id`,
      [id]
    )
    usuariosMasivos = umRows
  } catch (_) {
    // tabla puede no existir aun en fase 1
  }

  return {
    solicitud,
    servicios: servicios.map(s => ({
      id:       s.id,
      servicio: s.servicio,
      estado:   s.estado,
      datos:    s.datos,
      datosAtencion: s.datos_atencion || {},
    })),
    etapas,
    historial,
    solicitudesHijas,
    usuariosMasivos,
  }
}

// =============================== CREAR =====================================

async function crear(data) {
  const { idSolicitante, tipo = 'individual', servicios, usuariosMasivos } = data
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // 1. Generar numero
    const { rows: numRows } = await client.query(
      `SELECT generar_numero_solicitud() AS numero`
    )
    const numero = numRows[0].numero

    // 2. Obtener id_usuario_creador a partir de id_personal
    const { rows: usrRows } = await client.query(
      `SELECT id FROM usuarios WHERE id_personal = $1 AND activo = true LIMIT 1`,
      [idSolicitante]
    )
    const idUsuarioCreador = usrRows.length > 0 ? usrRows[0].id : null

    // 3. INSERT solicitud
    const { rows: solRows } = await client.query(
      `INSERT INTO solicitudes (numero, id_solicitante, id_usuario_creador, tipo, estado)
       VALUES ($1, $2, $3, $4, 'borrador')
       RETURNING id, numero`,
      [numero, idSolicitante, idUsuarioCreador, tipo]
    )
    const solicitudId = solRows[0].id

    // 4. INSERT solicitud_servicios
    for (const srv of servicios) {
      const { rows: srvRows } = await client.query(
        `SELECT id FROM servicios WHERE codigo = $1 AND activo = true`,
        [srv.codigoServicio]
      )
      if (srvRows.length === 0) {
        throw new Error(`Servicio con codigo '${srv.codigoServicio}' no encontrado`)
      }
      await client.query(
        `INSERT INTO solicitud_servicios (id_solicitud, id_servicio, datos)
         VALUES ($1, $2, $3)`,
        [solicitudId, srvRows[0].id, JSON.stringify(srv.datos || {})]
      )
    }

    // 5. Si masiva: INSERT usuarios_masivos (si la tabla existe)
    if (tipo === 'masiva' && Array.isArray(usuariosMasivos) && usuariosMasivos.length > 0) {
      for (const um of usuariosMasivos) {
        await client.query(
          `INSERT INTO usuarios_masivos
           (id_solicitud, dni, apellidos, nombres, cargo, internet_perfil, correo_personal, telefono_contacto, nombre_host, tipo_cuenta, correo_institucional)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            solicitudId, um.dni, um.apellidos, um.nombres, um.cargo,
            um.internetPerfil || null, um.correoPersonal || null,
            um.telefonoContacto || null, um.nombreHost || null,
            um.redTipoCuenta || 'personal', um.correoInstitucional || false,
          ]
        )
      }
    }

    // 6. INSERT historial — CREACION
    await client.query(
      `INSERT INTO historial (id_solicitud, tipo_evento, estado_nuevo, id_usuario, comentario)
       VALUES ($1, 'CREACION', 'borrador', $2, 'Solicitud creada')`,
      [solicitudId, idUsuarioCreador]
    )

    await client.query('COMMIT')
    return { id: solicitudId, numero }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// =============================== ENVIAR ====================================

async function enviar(id, idUsuario) {
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // 1. Obtener solicitud — debe estar en borrador
    const { rows: solRows } = await client.query(
      `SELECT * FROM solicitudes WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (solRows.length === 0) throw new Error('Solicitud no encontrada')
    const sol = solRows[0]

    if (sol.estado !== 'borrador') {
      throw new Error(`No se puede enviar: la solicitud esta en estado '${sol.estado}'`)
    }

    // 2. Obtener datos de personal para snapshot
    const { rows: perRows } = await client.query(
      `SELECT p.apellidos, p.nombres, p.dni, p.cargo, p.tipo_vinculo,
              p.correo, p.oficina, s.nombre AS sede
         FROM personal p
         LEFT JOIN sedes s ON s.id = p.id_sede
        WHERE p.id = $1`,
      [sol.id_solicitante]
    )
    if (perRows.length === 0) throw new Error('Personal no encontrado para la solicitud')
    const per = perRows[0]

    const snapNombres = `${per.nombres} ${per.apellidos}`.trim()

    // 3. UPDATE solicitud con snapshot y estado enviada
    await client.query(
      `UPDATE solicitudes
          SET estado           = 'enviada',
              fecha_envio      = NOW(),
              snap_nombres     = $2,
              snap_dni         = $3,
              snap_cargo       = $4,
              snap_vinculo     = $5,
              snap_correo      = $6,
              snap_oficina     = $7,
              snap_sede        = $8,
              updated_at       = NOW()
        WHERE id = $1`,
      [
        id,
        snapNombres, per.dni, per.cargo, per.tipo_vinculo,
        per.correo, per.oficina, per.sede,
      ]
    )

    // 4. Servicios quedan en pendiente — las etapas de aprobación se crean
    // cuando el usuario sube el documento firmado (confirmarFirmado)

    // 5. INSERT historial — ENVIO
    await client.query(
      `INSERT INTO historial
         (id_solicitud, tipo_evento, estado_nuevo, id_usuario, comentario)
       VALUES ($1, 'ENVIO', 'enviada', $2, 'Solicitud enviada para aprobacion')`,
      [id, idUsuario]
    )

    await client.query('COMMIT')

    // Retornar solicitud actualizada
    const { rows: updated } = await query(
      `SELECT * FROM solicitudes WHERE id = $1`,
      [id]
    )
    return updated[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ============================== CANCELAR ===================================

async function cancelar(id, idUsuario, motivo) {
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // 1. Obtener solicitud
    const { rows: solRows } = await client.query(
      `SELECT id, estado FROM solicitudes WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (solRows.length === 0) throw new Error('Solicitud no encontrada')
    const sol = solRows[0]

    if (sol.estado === 'completada' || sol.estado === 'cancelada') {
      throw new Error(`No se puede cancelar: la solicitud esta en estado '${sol.estado}'`)
    }

    // 2. UPDATE solicitud
    await client.query(
      `UPDATE solicitudes
          SET estado              = 'cancelada',
              motivo_cancelacion  = $2,
              fecha_cierre        = NOW(),
              updated_at          = NOW()
        WHERE id = $1`,
      [id, motivo]
    )

    // 3. INSERT historial — CANCELACION
    await client.query(
      `INSERT INTO historial
         (id_solicitud, tipo_evento, estado_nuevo, id_usuario, comentario)
       VALUES ($1, 'CANCELACION', 'cancelada', $2, $3)`,
      [id, idUsuario, motivo || 'Solicitud cancelada por el usuario']
    )

    await client.query('COMMIT')
    return { id, estado: 'cancelada' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// confirmarFirmado — Registra que el usuario subió el documento firmado
// ---------------------------------------------------------------------------
async function confirmarFirmado(id, idUsuario) {
  const client = await getClient()
  try {
    await client.query('BEGIN')

    // 1. Verificar solicitud existe y tiene firmado_url
    const { rows } = await client.query(
      `SELECT id, estado, firmado_url FROM solicitudes WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) throw new Error('Solicitud no encontrada')
    if (!rows[0].firmado_url) throw new Error('No se ha subido el documento firmado')

    // 2. UPDATE estado a en_proceso
    await client.query(
      `UPDATE solicitudes SET estado = 'en_proceso', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    // 3. Crear flujo de aprobación UNIFICADO (deduplicado por rol)
    const { rows: ssRows } = await client.query(
      `SELECT ss.id AS ss_id, ss.id_servicio
         FROM solicitud_servicios ss
        WHERE ss.id_solicitud = $1`,
      [id]
    )

    const allPasos = []
    for (const ss of ssRows) {
      const { rows: flujoRows } = await client.query(
        `SELECT id, orden, id_rol, sla_horas
           FROM config_flujo
          WHERE id_servicio = $1 AND activo = true
          ORDER BY orden ASC`,
        [ss.id_servicio]
      )
      allPasos.push(...flujoRows)
    }

    // Deduplicar por id_rol (mayor SLA)
    const rolMap = new Map()
    for (const paso of allPasos) {
      const existing = rolMap.get(paso.id_rol)
      if (!existing || paso.sla_horas > existing.sla_horas) {
        rolMap.set(paso.id_rol, paso)
      }
    }

    // Ordenar por mínimo orden original
    const minOrdenPorRol = new Map()
    for (const paso of allPasos) {
      const current = minOrdenPorRol.get(paso.id_rol)
      if (current === undefined || paso.orden < current) minOrdenPorRol.set(paso.id_rol, paso.orden)
    }
    const dedupPasos = Array.from(rolMap.values()).sort((a, b) => {
      const minA = minOrdenPorRol.get(a.id_rol) || 0
      const minB = minOrdenPorRol.get(b.id_rol) || 0
      if (minA !== minB) return minA - minB
      return (a.sla_horas || 0) - (b.sla_horas || 0)
    })

    // Crear etapas: primera en 'en_revision', resto 'pendiente'
    let ordenUnificado = 1
    for (const paso of dedupPasos) {
      const estadoInicial = ordenUnificado === 1 ? 'en_revision' : 'pendiente'
      await client.query(
        `INSERT INTO etapas_aprobacion
           (id_solicitud, id_config, orden, id_rol, estado, fecha_inicio, sla_horas)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
        [id, paso.id, ordenUnificado, paso.id_rol, estadoInicial, paso.sla_horas]
      )
      ordenUnificado++
    }

    // Marcar servicios como en_revision
    for (const ss of ssRows) {
      await client.query(
        `UPDATE solicitud_servicios SET estado = 'en_revision', updated_at = NOW() WHERE id = $1`,
        [ss.ss_id]
      )
    }

    // 4. INSERT historial — DOCUMENTO_FIRMADO
    await client.query(
      `INSERT INTO historial
         (id_solicitud, tipo_evento, estado_nuevo, id_usuario, comentario)
       VALUES ($1, 'DOCUMENTO_FIRMADO', 'en_proceso', $2, 'Documento firmado cargado — solicitud enviada a aprobación')`,
      [id, idUsuario]
    )

    await client.query('COMMIT')
    return { id, estado: 'en_proceso' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { listar, obtenerPorId, crear, enviar, cancelar, confirmarFirmado }
