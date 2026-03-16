const db = require('../config/db')

async function registrarAuditoria(userId, accion, tabla, idRegistro, antes, despues, ip) {
  try {
    await db.query(
      `INSERT INTO auditoria (id_usuario, accion, tabla_afectada, id_registro, datos_antes, datos_despues, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, accion, tabla, idRegistro, JSON.stringify(antes), JSON.stringify(despues), ip]
    )
  } catch (err) {
    console.error('[AUDITORIA] Error al registrar:', err.message)
  }
}

module.exports = { registrarAuditoria }
