const ok = (res, data, status = 200) => res.status(status).json(data)
const error = (res, status, message) => res.status(status).json({ error: message })
const created = (res, data) => res.status(201).json(data)

module.exports = { ok, error, created }
