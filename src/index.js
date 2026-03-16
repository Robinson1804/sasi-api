require('dotenv').config()

const fs = require('fs')
const path = require('path')
const app = require('./app')
const { pool } = require('./config/db')

const PORT = process.env.PORT || 3001

async function runMigrationIfNeeded() {
  // Force reset if env var set
  if (process.env.FORCE_RESET_DB === 'true') {
    console.log('⚠ FORCE_RESET_DB=true — Resetting database...')
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await pool.query('GRANT ALL ON SCHEMA public TO postgres')
    await pool.query('GRANT ALL ON SCHEMA public TO public')
    console.log('✓ Schema dropped and recreated')
  }

  // Check if tables exist
  const { rows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'servicios'`
  )
  if (Number(rows[0].cnt) > 0) {
    console.log('✓ Tablas ya existen, saltando migración')
    return
  }

  console.log('⚙ Ejecutando migración inicial...')
  const schemaPath = path.join(__dirname, '..', 'scripts', 'schema.sql')
  if (!fs.existsSync(schemaPath)) {
    console.log('⚠ schema.sql no encontrado, saltando migración')
    return
  }
  const sql = fs.readFileSync(schemaPath, 'utf8')
  await pool.query(sql)
  console.log('✓ Schema aplicado')

  // Patches para flujo unificado
  await pool.query(`
    ALTER TABLE etapas_aprobacion ADD COLUMN IF NOT EXISTS id_solicitud INT REFERENCES solicitudes(id);
    ALTER TABLE etapas_aprobacion ALTER COLUMN id_solicitud_servicio DROP NOT NULL;
  `)

  await pool.query(`
    CREATE OR REPLACE VIEW v_bandeja_aprobacion AS
    SELECT
      ea.id AS etapa_id, s.id AS solicitud_id, s.numero,
      s.snap_nombres AS solicitante, s.snap_sede AS sede, s.tipo,
      ea.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre,
      ea.estado AS etapa_estado, ea.fecha_inicio, ea.sla_horas,
      ea.horas_transcurridas, ea.vencio_sla,
      (SELECT ARRAY_AGG(DISTINCT sv2.codigo)
         FROM solicitud_servicios ss2 JOIN servicios sv2 ON sv2.id = ss2.id_servicio
        WHERE ss2.id_solicitud = s.id) AS servicios_codigos,
      GREATEST(0, ea.sla_horas - COALESCE(ea.horas_transcurridas,
        EXTRACT(EPOCH FROM (NOW() - ea.fecha_inicio)) / 3600)) AS horas_restantes_sla
    FROM etapas_aprobacion ea
    JOIN solicitudes s ON ea.id_solicitud = s.id
    JOIN roles r ON ea.id_rol = r.id
    WHERE ea.estado = 'en_revision'
    GROUP BY ea.id, s.id, r.id
  `)
  console.log('✓ Vista v_bandeja_aprobacion creada')

  console.log('✓ Migración completada!')
}

async function applyPatches() {
  // Patches que se aplican siempre (IF NOT EXISTS / idempotentes)
  await pool.query(`
    ALTER TABLE solicitud_servicios ADD COLUMN IF NOT EXISTS datos_atencion JSONB;
    ALTER TABLE etapas_aprobacion ADD COLUMN IF NOT EXISTS id_solicitud INT REFERENCES solicitudes(id);
  `)
  // DROP NOT NULL es idempotente si ya es nullable
  try {
    await pool.query(`ALTER TABLE etapas_aprobacion ALTER COLUMN id_solicitud_servicio DROP NOT NULL`)
  } catch { /* already nullable */ }

  // Vista unificada (CREATE OR REPLACE es idempotente)
  await pool.query(`
    CREATE OR REPLACE VIEW v_bandeja_aprobacion AS
    SELECT
      ea.id AS etapa_id, s.id AS solicitud_id, s.numero,
      s.snap_nombres AS solicitante, s.snap_sede AS sede, s.tipo,
      ea.id_rol, r.codigo AS rol_codigo, r.nombre AS rol_nombre,
      ea.estado AS etapa_estado, ea.fecha_inicio, ea.sla_horas,
      ea.horas_transcurridas, ea.vencio_sla,
      (SELECT ARRAY_AGG(DISTINCT sv2.codigo)
         FROM solicitud_servicios ss2 JOIN servicios sv2 ON sv2.id = ss2.id_servicio
        WHERE ss2.id_solicitud = s.id) AS servicios_codigos,
      GREATEST(0, ea.sla_horas - COALESCE(ea.horas_transcurridas,
        EXTRACT(EPOCH FROM (NOW() - ea.fecha_inicio)) / 3600)) AS horas_restantes_sla
    FROM etapas_aprobacion ea
    JOIN solicitudes s ON ea.id_solicitud = s.id
    JOIN roles r ON ea.id_rol = r.id
    WHERE ea.estado = 'en_revision'
    GROUP BY ea.id, s.id, r.id
  `)
  // Fix corrupted solicitud numbers and make function more robust
  await pool.query(`
    UPDATE solicitudes SET numero = 'SASI-' || EXTRACT(YEAR FROM fecha_creacion)::TEXT || '-' || LPAD(id::TEXT, 6, '0')
    WHERE numero !~ '^SASI-[0-9]{4}-[0-9]{6}$'
  `)

  await pool.query(`
    CREATE OR REPLACE FUNCTION generar_numero_solicitud()
    RETURNS VARCHAR(20) AS $$
    DECLARE
      anio TEXT;
      seq INT;
    BEGIN
      anio := EXTRACT(YEAR FROM NOW())::TEXT;
      SELECT COALESCE(MAX(
        CAST(SUBSTRING(numero FROM 11) AS INT)
      ), 0) + 1
      INTO seq
      FROM solicitudes
      WHERE numero ~ ('^SASI-' || anio || '-[0-9]+$');
      RETURN 'SASI-' || anio || '-' || LPAD(seq::TEXT, 6, '0');
    END;
    $$ LANGUAGE plpgsql;
  `)

  console.log('✓ Patches aplicados (datos_atencion, flujo unificado, numero solicitud)')
}

async function ensureTechUsers() {
  const bcrypt = require('bcryptjs')
  const techUsers = [
    {
      dni: '66666666', nombres: 'Luis', apellidos: 'Redes',
      cargo: 'Especialista en Redes', tipo_vinculo: 'Nombrado',
      correo: 'lredes@inei.gob.pe', oficina: 'Oficina Técnica de Informática',
      rolCodigo: 'equipo_redes'
    },
    {
      dni: '55555555', nombres: 'Ana', apellidos: 'DBA',
      cargo: 'Administradora de Base de Datos', tipo_vinculo: 'Nombrado',
      correo: 'adba@inei.gob.pe', oficina: 'Oficina Técnica de Informática',
      rolCodigo: 'dba'
    },
    {
      dni: '44444444', nombres: 'Pedro', apellidos: 'Soporte',
      cargo: 'Técnico de Soporte', tipo_vinculo: 'Nombrado',
      correo: 'psoporte@inei.gob.pe', oficina: 'Oficina Técnica de Informática',
      rolCodigo: 'soporte_tecnico'
    },
    {
      dni: '77777777', nombres: 'Carlos', apellidos: 'Mendoza',
      cargo: 'Jefe de OTIN', tipo_vinculo: 'Nombrado',
      correo: 'cmendoza@inei.gob.pe', oficina: 'Oficina Técnica de Informática',
      rolCodigo: 'jefe_supervisor'
    }
  ]

  // Get sede ID for "Lima - Sede Central"
  const { rows: sedeRows } = await pool.query(
    `SELECT id FROM sedes WHERE nombre ILIKE '%Lima%Sede Central%' LIMIT 1`
  )
  const idSede = sedeRows[0]?.id || null

  let created = 0
  for (const u of techUsers) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM personal WHERE dni = $1', [u.dni]
    )
    if (existing.length > 0) continue

    // Insert personal
    const { rows: [per] } = await pool.query(
      `INSERT INTO personal (dni, nombres, apellidos, cargo, tipo_vinculo, correo, oficina, id_sede, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVO') RETURNING id`,
      [u.dni, u.nombres, u.apellidos, u.cargo, u.tipo_vinculo, u.correo, u.oficina, idSede]
    )

    // Insert usuario with bcrypt(dni)
    const hash = await bcrypt.hash(u.dni, 10)
    const { rows: [usr] } = await pool.query(
      `INSERT INTO usuarios (id_personal, password_hash, activo) VALUES ($1, $2, true) RETURNING id`,
      [per.id, hash]
    )

    // Get role and assign
    const { rows: roles } = await pool.query(
      'SELECT id FROM roles WHERE codigo = $1', [u.rolCodigo]
    )
    if (roles.length > 0) {
      await pool.query(
        'INSERT INTO usuario_roles (id_usuario, id_rol) VALUES ($1, $2)',
        [usr.id, roles[0].id]
      )
    }
    created++
  }
  if (created > 0) {
    console.log(`✓ ${created} usuarios técnicos creados (66666666, 55555555, 44444444, 77777777)`)
  }
}

async function fixPlaceholderPasswords() {
  const bcrypt = require('bcryptjs')
  const { rows: users } = await pool.query(
    `SELECT u.id, p.dni FROM usuarios u JOIN personal p ON p.id = u.id_personal WHERE u.password_hash LIKE '%placeholder%'`
  )
  if (users.length === 0) return
  for (const u of users) {
    const hash = await bcrypt.hash(u.dni, 10)
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, u.id])
  }
  console.log(`✓ Passwords actualizados para ${users.length} usuarios (password = DNI)`)
}

async function start() {
  // Verify DB connection
  try {
    const result = await pool.query('SELECT NOW() as now')
    console.log(`✓ PostgreSQL conectado: ${result.rows[0].now}`)
    await runMigrationIfNeeded()
    await applyPatches()
    await ensureTechUsers()
    await fixPlaceholderPasswords()
  } catch (err) {
    console.error('✗ Error conectando a PostgreSQL:', err.message)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`✓ SASI API corriendo en http://localhost:${PORT}`)
    console.log(`  Frontend: ${process.env.FRONTEND_URL}`)
    console.log(`  Endpoints:`)
    console.log(`    POST /api/auth/login`)
    console.log(`    GET  /api/catalogos/servicios`)
    console.log(`    GET  /api/solicitudes`)
    console.log(`    GET  /api/bandeja`)
    console.log(`    GET  /api/dashboard/kpis`)
    console.log(`    GET  /api/personal`)
    console.log(`    POST /api/documentos/generar-pdf`)
  })
}

start()
