function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Acceso denegado: sin roles asignados' })
    }

    const hasRole = req.user.roles.some(rol => allowedRoles.includes(rol))
    if (!hasRole) {
      return res.status(403).json({ error: 'Acceso denegado: rol no autorizado' })
    }

    next()
  }
}

module.exports = { requireRole }
