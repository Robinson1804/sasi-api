function parsePagination(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

module.exports = { parsePagination }
