const jwt = require('jsonwebtoken')

function verifyToken(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = {
      id: decoded.id,
      idPersonal: decoded.idPersonal,
      dni: decoded.dni,
      rol: decoded.rol,
      roles: decoded.roles
    }
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

module.exports = { verifyToken }
