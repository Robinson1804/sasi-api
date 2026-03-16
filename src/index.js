require('dotenv').config()

const fs = require('fs')
const path = require('path')
const app = require('./app')
const { pool } = require('./config/db')

const PORT = process.env.PORT || 3001

async function runMigrationIfNeeded() {
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

  // Fix placeholder passwords — set password = DNI for each user
  const bcrypt = require('bcryptjs')
  const { rows: users } = await pool.query(
    `SELECT u.id, p.dni FROM usuarios u JOIN personal p ON p.id = u.id_personal WHERE u.password_hash LIKE '%placeholder%'`
  )
  for (const u of users) {
    const hash = await bcrypt.hash(u.dni, 10)
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, u.id])
  }
  console.log(`✓ Passwords actualizados para ${users.length} usuarios (password = DNI)`)
  console.log('✓ Migración completada!')
}

async function start() {
  // Verify DB connection
  try {
    const result = await pool.query('SELECT NOW() as now')
    console.log(`✓ PostgreSQL conectado: ${result.rows[0].now}`)
    await runMigrationIfNeeded()
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
