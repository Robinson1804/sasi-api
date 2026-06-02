// ---------------------------------------------------------------------------
// solicitudes.queries.js — Consultas de base de datos para Solicitudes
// ---------------------------------------------------------------------------
const { query, getClient } = require('../../config/db')

// ============================= LISTAR ======================================

async function listar(filters = {}) {
  const {
    estado, servicio, sede, periodo, search,
    idSolicitante, ocultarPendientesFirma = false,
    limit = 20, offset = 0,
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

  if (ocultarPendientesFirma) {
  conditions.push(`s.estado NOT IN ('borrador', 'enviada')`)
}

  const where = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : ''

  const countSql = `SELECT COUNT(*) AS total FROM solicitudes s ${where}`
  const { rows: countRows } = await query(countSql, params)
  const total = parseInt(countRows[0].total, 10)

  const dataSql = `
    WITH resumen_masivo AS (
      SELECT
        um.id_solicitud,
        COUNT(*) AS total_usuarios,
        COALESCE(
          SUM(
            (
              SELECT COUNT(*)
              FROM jsonb_each(um.datos_servicios) AS item(codigo, data)
              WHERE item.codigo IN ('c1', 'c4')
                AND item.data->>'estado' = 'aprobado'
            )
          ),
          0
        ) AS aprobados,
        COALESCE(
          SUM(
            (
              SELECT COUNT(*)
              FROM jsonb_each(um.datos_servicios) AS item(codigo, data)
              WHERE item.codigo IN ('c1', 'c4')
                AND item.data->>'estado' = 'observado'
            )
          ),
          0
        ) AS observados,
        COALESCE(
          SUM(
            (
              SELECT COUNT(*)
              FROM jsonb_each(um.datos_servicios) AS item(codigo, data)
              WHERE item.codigo IN ('c1', 'c4')
                AND item.data->>'estado' = 'rechazado'
            )
          ),
          0
        ) AS rechazados
      FROM usuarios_masivos um
      GROUP BY um.id_solicitud
    )
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
          ) AS servicios,
          CASE
            WHEN s.tipo = 'masiva' THEN
              json_build_object(
                'totalUsuarios', COALESCE(rm.total_usuarios, 0),
                'aprobados', COALESCE(rm.aprobados, 0),
                'observados', COALESCE(rm.observados, 0),
                'rechazados', COALESCE(rm.rechazados, 0)
              )
            ELSE NULL
          END AS resumen_masivo
      FROM solicitudes s
      LEFT JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
      LEFT JOIN servicios sv           ON sv.id = ss.id_servicio
      LEFT JOIN resumen_masivo rm      ON rm.id_solicitud = s.id
      ${where}
    GROUP BY s.id, rm.total_usuarios, rm.aprobados, rm.observados, rm.rechazados
    ORDER BY s.fecha_creacion DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `
  params.push(limit, offset)

  const { rows } = await query(dataSql, params)

  return { rows, total }
}

// ========================== OBTENER POR ID =================================

async function obtenerPorId(id) {
  const { rows: solRows } = await query(
    `SELECT s.*,
            s.pdf_url     AS pdf_url,
            s.firmado_url AS firmado_url
       FROM solicitudes s
      WHERE s.id = $1`,
    [id]
  )

  if (solRows.length === 0) return null

  const solicitud = solRows[0]

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

  const { rows: etapaRows } = await query(
    `SELECT ea.id,
            ea.orden,
            r.codigo   AS rol_codigo,
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
       JOIN roles r              ON r.id = ea.id_rol
       LEFT JOIN config_flujo cf ON cf.id = ea.id_config
       LEFT JOIN usuarios ua     ON ua.id = ea.id_aprobador
       LEFT JOIN personal pa     ON pa.id = ua.id_personal
      WHERE ea.id_solicitud = $1
      ORDER BY ea.orden`,
    [id]
  )

  const etapas = etapaRows.map(e => ({
    id:                 e.id,
    orden:              e.orden,
    rolCodigo:          e.rol_codigo,
    rolNombre:          e.rol_nombre,
    estado:             e.estado,
    aprobadorNombre:    e.aprobador_nombre,
    comentario:         e.comentario,
    fechaInicio:        e.fecha_inicio,
    fechaAccion:        e.fecha_accion,
    horasTranscurridas: e.horas_transcurridas,
    vencioSla:          e.vencio_sla,
    slaHoras:           e.sla_horas,
  }))

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
    id:            h.id,
    tipoEvento:    h.tipo_evento,
    estadoNuevo:   h.estado_nuevo,
    comentario:    h.comentario,
    usuarioNombre: h.usuario_nombre,
    createdAt:     h.created_at,
  }))

  let solicitudesHijas = []

  if (solicitud.tipo === 'masiva') {
    const { rows: hijasRows } = await query(
      `SELECT s2.id,
              s2.numero,
              s2.snap_nombres AS nombre_usuario,
              s2.snap_dni AS dni,
              s2.estado
         FROM solicitudes s2
        WHERE s2.numero LIKE $1 || '-H%'
        ORDER BY s2.numero`,
      [solicitud.numero]
    )

    solicitudesHijas = hijasRows
  }

  let usuariosMasivos = []

  try {
    const { rows: umRows } = await query(
      `SELECT
              um.*,
              p.tipo_vinculo AS tipo_vinculo_actual,
              p.fecha_inicio_contrato AS fecha_inicio_contrato_actual,
              p.fecha_fin_contrato AS fecha_fin_contrato_actual,
              p.correo AS correo_institucional_actual,
              p.telefono AS telefono_actual,
              p.oficina AS oficina_actual,
              se.nombre AS sede_actual
        FROM usuarios_masivos um
        LEFT JOIN personal p ON p.dni = um.dni
        LEFT JOIN sedes se ON se.id = p.id_sede
        WHERE um.id_solicitud = $1
        ORDER BY um.id`,
      [id]
    )

    usuariosMasivos = umRows

    usuariosMasivos = umRows
  } catch (_) {
    // La tabla puede no existir en entornos antiguos.
  }

  return {
    solicitud,
    servicios: servicios.map(s => ({
      id:             s.id,
      servicio:       s.servicio,
      estado:         s.estado,
      datos:          s.datos,
      datosAtencion:  s.datos_atencion || {},
    })),
    etapas,
    historial,
    solicitudesHijas,
    usuariosMasivos,
  }
}

// ============================== HELPERS ====================================

function parseDateOnly(value) {
  if (!value || typeof value !== 'string') return null

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null

  return date
}

function formatDatePE(value) {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('es-PE', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  })
}

function todayDateOnly() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function normalizarTexto(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getServiciosUsuarioMasivo(usuario) {
  if (!usuario || !Array.isArray(usuario.serviciosSeleccionados)) return []

  return usuario.serviciosSeleccionados.filter((codigo) =>
    ['c1', 'c4'].includes(codigo)
  )
}

function normalizarServiciosSolicitud(tipo, servicios = [], usuariosMasivos = []) {
  if (tipo !== 'masiva') return servicios

  const serviciosMap = new Map()

  for (const srv of servicios || []) {
    if (srv?.codigoServicio) {
      serviciosMap.set(srv.codigoServicio, srv)
    }
  }

  for (const usuario of usuariosMasivos || []) {
    const serviciosUsuario = getServiciosUsuarioMasivo(usuario)

    for (const codigo of serviciosUsuario) {
      if (!serviciosMap.has(codigo)) {
        serviciosMap.set(codigo, {
          codigoServicio: codigo,
          datos: {},
        })
      }
    }
  }

  return Array.from(serviciosMap.values())
}

function validarFechasPermiso(servicios, fechaFinContrato, tipoSolicitud = 'individual') {
  const contratoDate = fechaFinContrato ? new Date(fechaFinContrato) : null
  const hoy = todayDateOnly()

  for (const srv of servicios) {
    if (!['c4', 'c5', 'c6', 'c7', 'c8', 'c9'].includes(srv.codigoServicio)) continue

    // En solicitud masiva, C4 valida fechas por usuario.
    if (tipoSolicitud === 'masiva' && srv.codigoServicio === 'c4') {
      continue
    }

    const datos = srv.datos || {}

    if (srv.codigoServicio === 'c8' && datos.tipoAcceso !== 'temporal') {
      continue
    }

    const fechaInicio = parseDateOnly(
      srv.codigoServicio === 'c9'
        ? datos.fechaAlta
        : datos.fechaInicio
    )

    const fechaTermino = parseDateOnly(
      srv.codigoServicio === 'c8'
        ? datos.fechaFin
        : srv.codigoServicio === 'c9'
          ? datos.fechaBaja
          : datos.fechaTermino
    )

    if (!fechaInicio) {
      throw new Error(`La fecha de inicio del permiso es obligatoria para ${srv.codigoServicio.toUpperCase()}`)
    }

    if (!fechaTermino) {
      throw new Error(`La fecha de fin del permiso es obligatoria para ${srv.codigoServicio.toUpperCase()}`)
    }

    if (fechaInicio < hoy) {
      throw new Error('La fecha de inicio del permiso no puede ser menor a hoy')
    }

    if (fechaTermino < fechaInicio) {
      throw new Error('La fecha de fin del permiso no puede ser menor a la fecha de inicio')
    }

    if (contratoDate && fechaTermino > contratoDate) {
      throw new Error(
        `La fecha de fin del permiso no puede superar su fecha de fin de contrato (${formatDatePE(contratoDate)})`
      )
    }

    if (srv.codigoServicio === 'c9' && Array.isArray(datos.usuarios)) {
      for (let i = 0; i < datos.usuarios.length; i += 1) {
        const usuario = datos.usuarios[i]

        const fechaAlta = parseDateOnly(usuario.fechaAlta)
        const fechaBaja = parseDateOnly(usuario.fechaBaja)

        if (!usuario.fechaAlta && !usuario.fechaBaja) continue

        if (!fechaAlta) {
          throw new Error(`La fecha de alta del usuario adicional ${i + 1} es obligatoria para C9`)
        }

        if (!fechaBaja) {
          throw new Error(`La fecha de baja del usuario adicional ${i + 1} es obligatoria para C9`)
        }

        if (fechaAlta < hoy) {
          throw new Error(`La fecha de alta del usuario adicional ${i + 1} no puede ser menor a hoy`)
        }

        if (fechaBaja < fechaAlta) {
          throw new Error(`La fecha de baja del usuario adicional ${i + 1} no puede ser menor a la fecha de alta`)
        }

        if (contratoDate && fechaBaja > contratoDate) {
          throw new Error(
            `La fecha de fin del permiso no puede superar su fecha de fin de contrato (${formatDatePE(contratoDate)})`
          )
        }
      }
    }
  }
}

function puedeSolicitarCuentaGenerica(tipoVinculo) {
  const vinculo = normalizarTexto(tipoVinculo)
  return vinculo === 'CAS' || vinculo === 'NOMBRADO'
}

function validarReglasC1(servicios, personal, tipoSolicitud = 'individual') {
  const servicioC1 = servicios.find((srv) => srv.codigoServicio === 'c1')
  if (!servicioC1) return

  const datos = servicioC1.datos || {}
  const tipoOperacion = datos.tipoOperacion || 'creacion'
  const usuarioTieneCorreo = Boolean(String(personal.correo || '').trim())
  const puedeCuentaGenerica = puedeSolicitarCuentaGenerica(personal.tipo_vinculo)

  const redSolicitar = datos.redSolicitar === true
  const internetSolicitar = datos.internetSolicitar === true
  const correoSolicitar = datos.correoSolicitar === true

  if (!['creacion', 'actualizacion'].includes(tipoOperacion)) {
    throw new Error('C1: tipo de operación inválido')
  }

  if (tipoSolicitud !== 'individual') return

  if (tipoOperacion === 'creacion' && usuarioTieneCorreo) {
    throw new Error('C1: El usuario ya cuenta con correo institucional. Debe solicitar una actualización')
  }

  if (tipoOperacion === 'actualizacion' && !usuarioTieneCorreo) {
    throw new Error('C1: El usuario aún no tiene correo institucional. Debe solicitar creación')
  }

  if (tipoOperacion === 'creacion') {
    if (datos.redTipoCuenta === 'generica') {
      throw new Error('C1: En creación solo se permite cuenta de red personal')
    }

    if (correoSolicitar && datos.correoTipo && datos.correoTipo !== 'creacion') {
      throw new Error('C1: En creación el correo institucional debe ser de tipo creación')
    }
  }

  if (tipoOperacion === 'actualizacion') {
    if (correoSolicitar && datos.correoTipo !== 'aumento') {
      throw new Error('C1: En actualización solo se permite aumento de capacidad de correo')
    }

    if (
      correoSolicitar &&
      (!datos.correoCapacidad || String(datos.correoCapacidad).trim().length < 2)
    ) {
      throw new Error('C1: Debe indicar la nueva capacidad solicitada para el correo')
    }
  }

  if (redSolicitar && datos.redTipoCuenta === 'generica' && !puedeCuentaGenerica) {
  throw new Error('C1: La cuenta genérica solo está habilitada para usuarios con vínculo CAS o Nombrado')
}

  if (
    redSolicitar &&
    datos.redTipoCuenta === 'generica' &&
    (!datos.redNombreGenerico || String(datos.redNombreGenerico).trim().length < 3)
  ) {
    throw new Error('C1: Debe indicar el nombre de la cuenta genérica')
  }

  if (internetSolicitar) {
    const perfil = String(datos.internetPerfil || '3')

    if (!['1', '2', '3'].includes(perfil)) {
      throw new Error('C1: Perfil de Internet inválido')
    }

    if (
      (perfil === '1' || perfil === '2') &&
      (!datos.internetJustificacion || String(datos.internetJustificacion).trim().length < 10)
    ) {
      throw new Error('C1: La justificación de Internet es obligatoria para Perfil Intermedio o Avanzado')
    }

    if (perfil === '1' && !['con', 'sin'].includes(datos.internetRedesSociales)) {
      throw new Error('C1: Debe indicar si el Perfil Avanzado es con o sin redes sociales')
    }
  }
}

async function validarUsuariosMasivosPorServicio(client, usuariosMasivos = []) {
  if (!Array.isArray(usuariosMasivos) || usuariosMasivos.length === 0) {
    throw new Error('La solicitud grupal requiere al menos un usuario')
  }

  const hoy = todayDateOnly()

  for (let i = 0; i < usuariosMasivos.length; i += 1) {
    const usuario = usuariosMasivos[i] || {}

    const dni = String(usuario.dni || '').replace(/\D/g, '')
    const nombre =
      `${usuario.nombres || ''} ${usuario.apellidos || ''}`.trim() ||
      dni ||
      `Usuario ${i + 1}`

    const serviciosUsuario = getServiciosUsuarioMasivo(usuario)

    if (serviciosUsuario.length === 0) {
      throw new Error(`${nombre} debe tener al menos un servicio asignado`)
    }

    if (!/^\d{8}$/.test(dni)) {
      throw new Error(`El DNI de ${nombre} debe tener 8 dígitos`)
    }

    const { rows } = await client.query(
      `SELECT dni,
              nombres,
              apellidos,
              estado,
              tipo_vinculo,
              correo,
              fecha_fin_contrato
         FROM personal
        WHERE dni = $1
        LIMIT 1`,
      [dni]
    )

    if (rows.length === 0) {
      throw new Error(`${nombre} no se encuentra registrado en el sistema`)
    }

    const personal = rows[0]

    const contratoDate = personal.fecha_fin_contrato
      ? new Date(personal.fecha_fin_contrato)
      : null

    if (!contratoDate || Number.isNaN(contratoDate.getTime())) {
      throw new Error(`${nombre} no tiene fecha de fin de contrato registrada`)
    }

    if (contratoDate < hoy) {
      throw new Error(`El contrato de ${nombre} se encuentra vencido`)
    }

    if (personal.estado && String(personal.estado).toLowerCase() !== 'activo') {
      throw new Error(`${nombre} se encuentra en estado ${personal.estado}`)
    }

    // C1 — Cuenta de Red / Internet / Correo
    if (serviciosUsuario.includes('c1')) {
      const perfil = String(usuario.internetPerfil || '3')

      if (!['1', '2', '3'].includes(perfil)) {
        throw new Error(`C1: Perfil de Internet inválido para ${nombre}`)
      }

      if (
        (perfil === '1' || perfil === '2') &&
        (!usuario.internetJustificacion ||
          String(usuario.internetJustificacion).trim().length < 10)
      ) {
        throw new Error(
          `C1: ${nombre} requiere justificación de Internet para Perfil Intermedio o Avanzado`
        )
      }

      if (perfil === '1' && !['con', 'sin'].includes(usuario.internetRedesSociales || '')) {
        throw new Error(
          `C1: ${nombre} debe indicar si el Perfil Avanzado es con o sin redes sociales`
        )
      }

      const puedeCuentaGenerica = puedeSolicitarCuentaGenerica(personal.tipo_vinculo)

      if (usuario.redTipoCuenta === 'generica' && !puedeCuentaGenerica) {
        throw new Error(
          `C1: ${nombre} no puede solicitar cuenta genérica porque su vínculo no es CAS ni Nombrado`
        )
      }

      if (
        usuario.redTipoCuenta === 'generica' &&
        (!usuario.redNombreGenerico ||
          String(usuario.redNombreGenerico).trim().length < 3)
      ) {
        throw new Error(`C1: ${nombre} debe indicar el nombre de la cuenta genérica`)
      }
    }

    // C4 — Acceso Remoto VPN
    if (serviciosUsuario.includes('c4')) {
      if (!String(usuario.correoPersonal || '').trim()) {
        throw new Error(`C4: ${nombre} debe registrar correo personal`)
      }

      if (!String(usuario.vpnJustificacion || '').trim()) {
        throw new Error(`C4: ${nombre} debe registrar la justificación del acceso VPN`)
      }

      if (String(usuario.vpnJustificacion || '').trim().length < 10) {
        throw new Error(`C4: ${nombre} debe registrar una justificación VPN de al menos 10 caracteres`)
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          String(usuario.correoPersonal || '').trim()
        )
      ) {
        throw new Error(`C4: ${nombre} debe registrar un correo personal válido`)
      }

      if (!String(usuario.telefonoContacto || '').trim()) {
        throw new Error(`C4: ${nombre} debe registrar teléfono de contacto`)
      }

      if (!String(usuario.nombreHost || '').trim()) {
        throw new Error(`C4: ${nombre} debe registrar el nombre del equipo personal`)
      }

      const fechaInicio = parseDateOnly(usuario.vpnFechaInicio)
      const fechaFin = parseDateOnly(usuario.vpnFechaFin)

      if (!fechaInicio) {
        throw new Error(`C4: ${nombre} debe registrar fecha de inicio del permiso VPN`)
      }

      if (!fechaFin) {
        throw new Error(`C4: ${nombre} debe registrar fecha de fin del permiso VPN`)
      }

      if (fechaInicio < hoy) {
        throw new Error(`C4: ${nombre} tiene una fecha de inicio menor a hoy`)
      }

      if (fechaFin < fechaInicio) {
        throw new Error(
          `C4: ${nombre} tiene una fecha de fin menor a la fecha de inicio`
        )
      }

      if (fechaFin > contratoDate) {
        throw new Error(
          `C4: La fecha fin VPN de ${nombre} no puede superar su fecha de fin de contrato (${formatDatePE(contratoDate)})`
        )
      }
    }
  }
}

// =============================== CREAR =====================================

async function crear(data) {
  const { idSolicitante, tipo = 'individual', servicios = [], usuariosMasivos = [] } = data
  const client = await getClient()

  try {
    await client.query('BEGIN')

    const { rows: personalRows } = await client.query(
      `SELECT fecha_fin_contrato,
              correo,
              tipo_vinculo
         FROM personal
        WHERE id = $1`,
      [idSolicitante]
    )

    if (personalRows.length === 0) {
      throw new Error('Personal no encontrado para validar fechas de permiso')
    }

    const personal = personalRows[0]
    const fechaFinContrato = personal.fecha_fin_contrato

    const serviciosNormalizados = normalizarServiciosSolicitud(
      tipo,
      servicios,
      usuariosMasivos
    )

    if (!Array.isArray(serviciosNormalizados) || serviciosNormalizados.length === 0) {
      throw new Error('Debe seleccionar al menos un servicio')
    }

    validarFechasPermiso(serviciosNormalizados, fechaFinContrato, tipo)

    if (tipo === 'masiva') {
      await validarUsuariosMasivosPorServicio(client, usuariosMasivos)
    } else {
      validarReglasC1(serviciosNormalizados, personal, tipo)
    }

    const { rows: numRows } = await client.query(
      `SELECT generar_numero_solicitud() AS numero`
    )

    const numero = numRows[0].numero

    const { rows: usrRows } = await client.query(
      `SELECT id FROM usuarios WHERE id_personal = $1 AND activo = true LIMIT 1`,
      [idSolicitante]
    )

    const idUsuarioCreador = usrRows.length > 0 ? usrRows[0].id : null

    const { rows: solRows } = await client.query(
      `INSERT INTO solicitudes (numero, id_solicitante, id_usuario_creador, tipo, estado)
       VALUES ($1, $2, $3, $4, 'borrador')
       RETURNING id, numero`,
      [numero, idSolicitante, idUsuarioCreador, tipo]
    )

    const solicitudId = solRows[0].id

    for (const srv of serviciosNormalizados) {
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

    if (tipo === 'masiva') {
      await client.query(
        `ALTER TABLE usuarios_masivos
           ADD COLUMN IF NOT EXISTS servicios_solicitados jsonb DEFAULT '[]'::jsonb`
      )

      await client.query(
        `ALTER TABLE usuarios_masivos
           ADD COLUMN IF NOT EXISTS datos_servicios jsonb DEFAULT '{}'::jsonb`
      )
    }

    if (tipo === 'masiva' && Array.isArray(usuariosMasivos) && usuariosMasivos.length > 0) {
      for (const um of usuariosMasivos) {
        const serviciosUsuario = getServiciosUsuarioMasivo(um)

        await client.query(
          `INSERT INTO usuarios_masivos
           (
             id_solicitud,
             dni,
             apellidos,
             nombres,
             cargo,
             internet_perfil,
             correo_personal,
             telefono_contacto,
             nombre_host,
             tipo_cuenta,
             correo_institucional,
             servicios_solicitados,
             datos_servicios
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
          [
            solicitudId,
            um.dni,
            um.apellidos,
            um.nombres,
            um.cargo,
            serviciosUsuario.includes('c1') ? um.internetPerfil || '3' : null,
            serviciosUsuario.includes('c4') ? um.correoPersonal || null : null,
            serviciosUsuario.includes('c4') ? um.telefonoContacto || null : null,
            serviciosUsuario.includes('c4') ? um.nombreHost || null : null,
            serviciosUsuario.includes('c1') ? um.redTipoCuenta || 'personal' : null,
            serviciosUsuario.includes('c1') ? Boolean(um.correoInstitucional) : false,
            JSON.stringify(serviciosUsuario),
            JSON.stringify({
              serviciosSeleccionados: serviciosUsuario,
              c1: serviciosUsuario.includes('c1')
                ? {
                    internetPerfil: usuarioValue(um.internetPerfil, '3'),
                    internetJustificacion: usuarioValue(um.internetJustificacion, ''),
                    internetRedesSociales: usuarioValue(um.internetRedesSociales, 'sin'),
                    redTipoCuenta: usuarioValue(um.redTipoCuenta, 'personal'),
                    redNombreGenerico: usuarioValue(um.redNombreGenerico, ''),
                    correoInstitucional: Boolean(um.correoInstitucional),
                  }
                : null,
              c4: serviciosUsuario.includes('c4')
                ? {
                    correoPersonal: usuarioValue(um.correoPersonal, ''),
                    telefonoContacto: usuarioValue(um.telefonoContacto, ''),
                    nombreHost: usuarioValue(um.nombreHost, ''),
                    vpnJustificacion: usuarioValue(um.vpnJustificacion, ''),
                    vpnFechaInicio: usuarioValue(um.vpnFechaInicio, ''),
                    vpnFechaFin: usuarioValue(um.vpnFechaFin, ''),
                  }
                : null,
            }),
          ]
        )
      }
    }

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

function usuarioValue(value, fallback) {
  if (value === null || value === undefined) return fallback
  return value
}

// =============================== ENVIAR ====================================

async function enviar(id, idUsuario) {
  const client = await getClient()

  try {
    await client.query('BEGIN')

    const { rows: solRows } = await client.query(
      `SELECT * FROM solicitudes WHERE id = $1 FOR UPDATE`,
      [id]
    )

    if (solRows.length === 0) throw new Error('Solicitud no encontrada')

    const sol = solRows[0]

    if (sol.estado !== 'borrador') {
      throw new Error(`No se puede enviar: la solicitud esta en estado '${sol.estado}'`)
    }

    const { rows: perRows } = await client.query(
      `SELECT p.apellidos,
              p.nombres,
              p.dni,
              p.cargo,
              p.tipo_vinculo,
              p.correo,
              p.telefono,
              p.oficina,
              s.nombre AS sede
         FROM personal p
         LEFT JOIN sedes s ON s.id = p.id_sede
        WHERE p.id = $1`,
      [sol.id_solicitante]
    )

    if (perRows.length === 0) {
      throw new Error('Personal no encontrado para la solicitud')
    }

    const per = perRows[0]
    const snapNombres = `${per.nombres} ${per.apellidos}`.trim()

    await client.query(
      `UPDATE solicitudes
          SET estado        = 'enviada',
              fecha_envio   = NOW(),
              snap_nombres  = $2,
              snap_dni      = $3,
              snap_cargo    = $4,
              snap_vinculo  = $5,
              snap_correo   = $6,
              snap_telefono = $7,
              snap_oficina  = $8,
              snap_sede     = $9,
              updated_at    = NOW()
        WHERE id = $1`,
      [
        id,
        snapNombres,
        per.dni,
        per.cargo,
        per.tipo_vinculo,
        per.correo,
        per.telefono,
        per.oficina,
        per.sede,
      ]
    )

    await client.query(
      `INSERT INTO historial
         (id_solicitud, tipo_evento, estado_nuevo, id_usuario, comentario)
       VALUES ($1, 'ENVIO', 'enviada', $2, 'Solicitud enviada para aprobacion')`,
      [id, idUsuario]
    )

    await client.query('COMMIT')

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

    const { rows: solRows } = await client.query(
      `SELECT id, estado FROM solicitudes WHERE id = $1 FOR UPDATE`,
      [id]
    )

    if (solRows.length === 0) throw new Error('Solicitud no encontrada')

    const sol = solRows[0]

    if (sol.estado === 'completada' || sol.estado === 'cancelada') {
      throw new Error(`No se puede cancelar: la solicitud esta en estado '${sol.estado}'`)
    }

    await client.query(
      `UPDATE solicitudes
          SET estado             = 'cancelada',
              motivo_cancelacion = $2,
              fecha_cierre       = NOW(),
              updated_at         = NOW()
        WHERE id = $1`,
      [id, motivo]
    )

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

    const { rows } = await client.query(
      `SELECT id, estado, firmado_url FROM solicitudes WHERE id = $1`,
      [id]
    )

    if (rows.length === 0) throw new Error('Solicitud no encontrada')
    if (!rows[0].firmado_url) throw new Error('No se ha subido el documento firmado')

    await client.query(
      `UPDATE solicitudes SET estado = 'en_proceso', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    const { rows: ssRows } = await client.query(
      `SELECT ss.id AS ss_id,
              ss.id_servicio,
              sv.codigo AS servicio_codigo
         FROM solicitud_servicios ss
         JOIN servicios sv ON sv.id = ss.id_servicio
        WHERE ss.id_solicitud = $1
        ORDER BY sv.orden`,
      [id]
    )

    const allPasos = []

    for (const ss of ssRows) {
      const { rows: flujoRows } = await client.query(
        `SELECT id, orden, id_rol, sla_horas
           FROM config_flujo
          WHERE id_servicio = $1
            AND activo = true
          ORDER BY orden ASC`,
        [ss.id_servicio]
      )

      for (const paso of flujoRows) {
        allPasos.push({
          ...paso,
          servicio_codigo: ss.servicio_codigo,
        })
      }
    }

    const etapaMap = new Map()

    for (const paso of allPasos) {
      const key = `${paso.orden}-${paso.id_rol}`
      const existing = etapaMap.get(key)

      if (!existing || Number(paso.sla_horas || 0) > Number(existing.sla_horas || 0)) {
        etapaMap.set(key, paso)
      }
    }

    const pasosUnificados = Array.from(etapaMap.values()).sort((a, b) => {
      if (a.orden !== b.orden) return a.orden - b.orden
      return a.id_rol - b.id_rol
    })

    if (pasosUnificados.length === 0) {
      throw new Error('No existe flujo activo configurado para los servicios de la solicitud')
    }

    let primera = true

    for (const paso of pasosUnificados) {
      const estadoInicial = primera ? 'en_revision' : 'pendiente'

      await client.query(
        `INSERT INTO etapas_aprobacion
          (id_solicitud, id_config, orden, id_rol, estado, fecha_inicio, sla_horas)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
        [id, paso.id, paso.orden, paso.id_rol, estadoInicial, paso.sla_horas]
      )

      primera = false
    }

    for (const ss of ssRows) {
      await client.query(
        `UPDATE solicitud_servicios
            SET estado = 'en_revision',
                updated_at = NOW()
          WHERE id = $1`,
        [ss.ss_id]
      )
    }

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

module.exports = {
  listar,
  obtenerPorId,
  crear,
  enviar,
  cancelar,
  confirmarFirmado,
}