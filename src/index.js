require('dotenv').config()

const app = require('./app')
const { pool } = require('./config/db')

const PORT = process.env.PORT || 3001

async function start() {
  // Verify DB connection
  try {
    const result = await pool.query('SELECT NOW() as now')
    console.log(`✓ PostgreSQL conectado: ${result.rows[0].now}`)
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
