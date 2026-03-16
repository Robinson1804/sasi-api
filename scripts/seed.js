/**
 * Seed script: hashea passwords de los usuarios mock
 * Ejecutar: npm run seed
 */
require('dotenv').config()
const bcrypt = require('bcryptjs')
const { pool } = require('../src/config/db')

async function seed() {
  const defaultPassword = 'sasi2026'
  const hash = await bcrypt.hash(defaultPassword, 10)

  console.log('Actualizando passwords de usuarios mock...')
  console.log(`  Password por defecto: ${defaultPassword}`)

  const result = await pool.query(
    'UPDATE usuarios SET password_hash = $1',
    [hash]
  )

  console.log(`  ${result.rowCount} usuarios actualizados con password hasheada`)

  // Verify
  const users = await pool.query(`
    SELECT p.dni, p.nombres, p.apellidos,
           ARRAY_AGG(r.codigo) as roles
    FROM usuarios u
    JOIN personal p ON u.id_personal = p.id
    LEFT JOIN usuario_roles ur ON ur.id_usuario = u.id AND ur.activo = true
    LEFT JOIN roles r ON ur.id_rol = r.id
    GROUP BY p.dni, p.nombres, p.apellidos, u.id
    ORDER BY u.id
  `)

  console.log('\nUsuarios disponibles:')
  users.rows.forEach(u => {
    console.log(`  DNI: ${u.dni} — ${u.nombres} ${u.apellidos} — Roles: ${u.roles.filter(Boolean).join(', ')}`)
  })

  await pool.end()
  console.log('\n✓ Seed completado')
}

seed().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
