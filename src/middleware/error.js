function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err)

  const isProduction = process.env.NODE_ENV === 'production'
  const message = isProduction ? 'Error interno del servidor' : err.message

  res.status(500).json({ error: message })
}

module.exports = { errorHandler }
