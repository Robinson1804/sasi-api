/**
 * Railway migration script
 * Ejecuta schema.sql y Seed.sql contra DATABASE_URL.
 *
 * Uso:
 *   node scripts/migrate.js
 *
 * Requiere:
 *   DATABASE_URL=postgres://...
 */

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

function readSqlFile(filename) {
  const filePath = path.join(__dirname, filename)

  if (!fs.existsSync(filePath)) {
    return null
  }

  let sql = fs.readFileSync(filePath, 'utf8')

  // pgAdmin/pg_dump 16 puede agregar comandos psql que node-postgres no soporta.
  sql = sql
    .split('\n')
    .filter((line) => {
      const clean = line.trim()
      return !clean.startsWith('\\restrict') && !clean.startsWith('\\unrestrict')
    })
    .join('\n')

  return sql.trim()
}

async function runSql(pool, label, sql) {
  if (!sql) {
    console.log(`Skipping ${label}: file not found or empty.`)
    return
  }

  console.log(`Running ${label}...`)
  await pool.query(sql)
  console.log(`${label} applied successfully.`)
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('Migration failed: DATABASE_URL is not defined.')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  })

  const schemaSql = readSqlFile('schema.sql')
  const seedSql = readSqlFile('Seed.sql')

  console.log('Connecting to database...')

  try {
    await runSql(pool, 'schema.sql', schemaSql)
    await runSql(pool, 'Seed.sql', seedSql)

    console.log('Migration completed successfully.')
  } catch (err) {
    console.error('Migration failed:', err.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

migrate()