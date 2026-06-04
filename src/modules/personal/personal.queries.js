const { query, getClient } = require('../../config/db')
const bcrypt = require('bcryptjs')

/* ───────── SQL base para listar / obtener ───────── */

const SQL_BASE = `
  SELECT p.id, p.dni, p.apellidos, p.nombres, p.tipo_vinculo, p.cargo,
         p.correo, p.telefono, p.oficina, s.nombre AS sede,
         p.fecha_inicio_contrato, p.fecha_fin_contrato, p.estado,
         p.num_orden_servicio,
         u.activo,
         ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL) AS roles
    FROM personal p
    LEFT JOIN sedes s          ON p.id_sede = s.id
    LEFT JOIN usuarios u       ON u.id_personal = p.id
    LEFT JOIN usuario_roles ur ON ur.id_usuario = u.id
    LEFT JOIN roles r          ON ur.id_rol = r.id
`

const SQL_GROUP_ORDER = `
  GROUP BY p.id, s.nombre, u.activo
  ORDER BY p.apellidos, p.nombres
`

/* ───────── mapRow: snake_case → camelCase ───────── */

function mapRow(row) {
  return {
    id: row.id,
    dni: row.dni,
    apellidos: row.apellidos,
    nombres: row.nombres,
    tipoVinculo: row.tipo_vinculo,
    cargo: row.cargo,
    correo: row.correo,
    telefono: row.telefono,
    oficina: row.oficina,
    sede: row.sede,
    numOrdenServicio: row.num_orden_servicio,
    fechaInicioContrato: row.fecha_inicio_contrato,
    fechaFinContrato: row.fecha_fin_contrato,
    estado: row.estado,
    roles: row.roles || [],
    activo: row.activo,
  }
}

function normalizarEstado(value) {
  const estado = String(value || '').trim().toUpperCase()

  if (estado === 'ACTIVO' || estado === 'VIGENTE') return 'ACTIVO'
  if (estado === 'INACTIVO' || estado === 'VENCIDO') return 'INACTIVO'
  if (estado === 'SUSPENDIDO') return 'SUSPENDIDO'

  return 'ACTIVO'
}

function estadoToActivo(estado) {
  return normalizarEstado(estado) === 'ACTIVO'
}

function estadoToActivo(estado) {
  return normalizarEstado(estado) === 'activo'
}

async function asegurarRolSolicitante(client, usuarioId, rolSolicitanteId) {
  if (!usuarioId || !rolSolicitanteId) return

  await client.query(
    `INSERT INTO usuario_roles (id_usuario, id_rol)
     SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1
          FROM usuario_roles
         WHERE id_usuario = $1
           AND id_rol = $2
      )`,
    [usuarioId, rolSolicitanteId],
  )
}

/* ───────── listar ───────── */

async function listar(filters = {}) {
  const { search, vinculo, sede, estado, limit, offset } = filters

  const conditions = []
  const params = []
  let idx = 1

  if (search) {
    conditions.push(
      `(p.dni ILIKE $${idx} OR p.apellidos ILIKE $${idx} OR p.nombres ILIKE $${idx})`,
    )
    params.push(`%${search}%`)
    idx++
  }

  if (vinculo) {
    conditions.push(`p.tipo_vinculo = $${idx}`)
    params.push(vinculo)
    idx++
  }

  if (sede) {
    conditions.push(`s.nombre = $${idx}`)
    params.push(sede)
    idx++
  }

  if (estado) {
    conditions.push(`p.estado = $${idx}`)
    params.push(estado)
    idx++
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

  const countSQL = `
    SELECT COUNT(DISTINCT p.id) AS total
      FROM personal p
      LEFT JOIN sedes s ON p.id_sede = s.id
     ${where}
  `

  const { rows: countRows } = await query(countSQL, params)
  const total = parseInt(countRows[0].total, 10)

  const dataSQL = `${SQL_BASE}${where}${SQL_GROUP_ORDER} LIMIT $${idx} OFFSET $${idx + 1}`
  params.push(limit, offset)

  const { rows } = await query(dataSQL, params)

  return { data: rows.map(mapRow), total }
}

/* ───────── obtenerPorId ───────── */

async function obtenerPorId(id) {
  const sql = `${SQL_BASE} WHERE p.id = $1 ${SQL_GROUP_ORDER}`
  const { rows } = await query(sql, [id])

  return rows.length ? mapRow(rows[0]) : null
}

/* ───────── crear (transacción) ───────── */

async function crear(data) {
  const {
    dni,
    apellidos,
    nombres,
    tipoVinculo,
    cargo,
    correo,
    telefono,
    oficina,
    sede,
    roles = [],
    activo = true,
  } = data

  const client = await getClient()

  try {
    await client.query('BEGIN')

    const { rows: sedeRows } = await client.query(
      'SELECT id FROM sedes WHERE nombre = $1',
      [sede],
    )

    const idSede = sedeRows.length ? sedeRows[0].id : null

    const { rows: pRows } = await client.query(
      `INSERT INTO personal
         (dni, apellidos, nombres, tipo_vinculo, cargo, correo, telefono, oficina, id_sede, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        dni,
        apellidos,
        nombres,
        tipoVinculo,
        cargo,
        correo,
        telefono,
        oficina,
        idSede,
        activo ? 'ACTIVO' : 'INACTIVO'
      ],
    )

    const personalId = pRows[0].id

    const hash = await bcrypt.hash(String(dni), 10)

    const { rows: uRows } = await client.query(
      `INSERT INTO usuarios (id_personal, password_hash, activo)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [personalId, hash, activo],
    )

    const usuarioId = uRows[0].id

    for (const codigoRol of roles) {
      await client.query(
        `INSERT INTO usuario_roles (id_usuario, id_rol)
         SELECT $1, r.id
           FROM roles r
          WHERE r.codigo = $2`,
        [usuarioId, codigoRol],
      )
    }

    await client.query('COMMIT')

    return obtenerPorId(personalId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/* ───────── actualizar (transacción) ───────── */

async function actualizar(id, data) {
  const { cargo, oficina, sede, roles = [], activo } = data

  const client = await getClient()

  try {
    await client.query('BEGIN')

    let idSede = undefined

    if (sede !== undefined) {
      const { rows: sedeRows } = await client.query(
        'SELECT id FROM sedes WHERE nombre = $1',
        [sede],
      )

      idSede = sedeRows.length ? sedeRows[0].id : null
    }

    const setClauses = []
    const params = []
    let idx = 1

    if (cargo !== undefined) {
      setClauses.push(`cargo = $${idx++}`)
      params.push(cargo)
    }

    if (oficina !== undefined) {
      setClauses.push(`oficina = $${idx++}`)
      params.push(oficina)
    }

    if (idSede !== undefined) {
      setClauses.push(`id_sede = $${idx++}`)
      params.push(idSede)
    }

    if (activo !== undefined) {
      setClauses.push(`estado = $${idx++}`)
      params.push(activo ? 'ACTIVO' : 'INACTIVO')
    }

    if (setClauses.length > 0) {
      params.push(id)

      await client.query(
        `UPDATE personal SET ${setClauses.join(', ')} WHERE id = $${idx}`,
        params,
      )
    }

    let { rows: uRows } = await client.query(
      'SELECT id FROM usuarios WHERE id_personal = $1',
      [id],
    )

    if (uRows.length === 0) {
      const { rows: pRows } = await client.query(
        'SELECT dni FROM personal WHERE id = $1',
        [id],
      )

      const dniValue = pRows.length ? String(pRows[0].dni) : String(id)
      const hash = await bcrypt.hash(dniValue, 10)

      const { rows: newU } = await client.query(
        `INSERT INTO usuarios (id_personal, password_hash, activo)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [id, hash, activo !== undefined ? activo : true],
      )

      uRows = newU
    } else if (activo !== undefined) {
      await client.query(
        'UPDATE usuarios SET activo = $1 WHERE id_personal = $2',
        [activo, id],
      )
    }

    const usuarioId = uRows[0].id

    await client.query(
      'DELETE FROM usuario_roles WHERE id_usuario = $1',
      [usuarioId],
    )

    for (const codigoRol of roles) {
      await client.query(
        `INSERT INTO usuario_roles (id_usuario, id_rol)
         SELECT $1, r.id
           FROM roles r
          WHERE r.codigo = $2`,
        [usuarioId, codigoRol],
      )
    }

    await client.query('COMMIT')

    return obtenerPorId(id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/* ───────── sincronizar (masivo desde externos) ───────── */

async function sincronizar(listaExternos) {
  const client = await getClient()

  let created = 0
  let updated = 0
  let usersCreated = 0
  let usersReactivated = 0

  try {
    await client.query('BEGIN')

    const { rows: sedeRows } = await client.query('SELECT id, nombre FROM sedes')

    const sedeMap = {}

    for (const s of sedeRows) {
      sedeMap[s.nombre.toLowerCase()] = s.id
    }

    const { rows: rolRows } = await client.query(
      "SELECT id FROM roles WHERE codigo = 'usuario_solicitante'",
    )

    const rolSolicitanteId = rolRows.length ? rolRows[0].id : null

    for (const ext of listaExternos) {
      const {
        dni,
        apellidos,
        nombres,
        tipoVinculo,
        cargo,
        correo,
        celular,
        unidad,
        sede,
        numOrdenServicio,
        fechaInicioContrato,
        fechaFinContrato,
        estado,
      } = ext

      if (!dni) continue

      const dniValue = String(dni).padStart(8, '0')
      const estadoNormalizado = normalizarEstado(estado)
      const activoUsuario = estadoToActivo(estadoNormalizado)
      const idSede = sede ? sedeMap[String(sede).toLowerCase()] || null : null

      const { rows: existentes } = await client.query(
        'SELECT id FROM personal WHERE dni = $1',
        [dniValue],
      )

      if (existentes.length > 0) {
        const personalId = existentes[0].id

        await client.query(
          `UPDATE personal
              SET apellidos = COALESCE($1, apellidos),
                  nombres = COALESCE($2, nombres),
                  tipo_vinculo = COALESCE($3, tipo_vinculo),
                  cargo = COALESCE($4, cargo),
                  correo = COALESCE($5, correo),
                  telefono = COALESCE($6, telefono),
                  oficina = COALESCE($7, oficina),
                  id_sede = COALESCE($8, id_sede),
                  fecha_inicio_contrato = COALESCE($9, fecha_inicio_contrato),
                  fecha_fin_contrato = COALESCE($10, fecha_fin_contrato),
                  num_orden_servicio = COALESCE($11, num_orden_servicio),
                  estado = COALESCE($12, estado)
            WHERE id = $13`,
          [
            apellidos || null,
            nombres || null,
            tipoVinculo || null,
            cargo || null,
            correo || null,
            celular || null,
            unidad || null,
            idSede,
            fechaInicioContrato || null,
            fechaFinContrato || null,
            numOrdenServicio || null,
            estadoNormalizado || null,
            personalId,
          ],
        )

        let { rows: usuarioRows } = await client.query(
          'SELECT id, activo FROM usuarios WHERE id_personal = $1',
          [personalId],
        )

        if (usuarioRows.length === 0) {
          const hash = await bcrypt.hash(dniValue, 10)

          const { rows: newUsuarioRows } = await client.query(
            `INSERT INTO usuarios (id_personal, password_hash, activo)
             VALUES ($1, $2, $3)
             RETURNING id, activo`,
            [personalId, hash, activoUsuario],
          )

          usuarioRows = newUsuarioRows
          usersCreated++
        } else {
          await client.query(
            'UPDATE usuarios SET activo = $1 WHERE id_personal = $2',
            [activoUsuario, personalId],
          )

          if (!usuarioRows[0].activo && activoUsuario) {
            usersReactivated++
          }
        }

        await asegurarRolSolicitante(
          client,
          usuarioRows[0].id,
          rolSolicitanteId,
        )

        updated++
      } else {
        const { rows: pRows } = await client.query(
          `INSERT INTO personal
             (dni, apellidos, nombres, tipo_vinculo, cargo, correo, telefono,
              oficina, id_sede, fecha_inicio_contrato, fecha_fin_contrato,
              num_orden_servicio, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            dniValue,
            apellidos,
            nombres,
            tipoVinculo,
            cargo,
            correo,
            celular,
            unidad,
            idSede,
            fechaInicioContrato || null,
            fechaFinContrato || null,
            numOrdenServicio || null,
            estadoNormalizado,
          ],
        )

        const personalId = pRows[0].id
        const hash = await bcrypt.hash(dniValue, 10)

        const { rows: uRows } = await client.query(
          `INSERT INTO usuarios (id_personal, password_hash, activo)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [personalId, hash, activoUsuario],
        )

        const usuarioId = uRows[0].id

        await asegurarRolSolicitante(client, usuarioId, rolSolicitanteId)

        created++
        usersCreated++
      }
    }

    await client.query('COMMIT')

    return {
      created,
      updated,
      usersCreated,
      usersReactivated,
    }
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
  actualizar,
  sincronizar,
}