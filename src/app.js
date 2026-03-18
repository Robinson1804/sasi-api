const express = require('express')
const cors = require('cors')
const { errorHandler } = require('./middleware/error')

// Route imports
const authRoutes = require('./modules/auth/auth.routes')
const catalogosRoutes = require('./modules/catalogos/catalogos.routes')
const solicitudesRoutes = require('./modules/solicitudes/solicitudes.routes')
const bandejaRoutes = require('./modules/bandeja/bandeja.routes')
const dashboardRoutes = require('./modules/dashboard/dashboard.routes')
const personalRoutes = require('./modules/personal/personal.routes')
const documentosRoutes = require('./modules/documentos/documentos.routes')
const externosRoutes = require('./modules/externos/externos.routes')
const perfilTiRoutes = require('./modules/perfil-ti/perfil-ti.routes')

const app = express()

// ── Global middleware ──
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3001',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))
app.use(express.json({ limit: '5mb' }))

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Routes ──
app.use('/api/auth', authRoutes)
app.use('/api/catalogos', catalogosRoutes)
app.use('/api/solicitudes', solicitudesRoutes)
app.use('/api/bandeja', bandejaRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/personal', personalRoutes)
app.use('/api/documentos', documentosRoutes)
app.use('/api/externos', externosRoutes)
app.use('/api/perfil-ti', perfilTiRoutes)

// ── Static: uploads ──
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'))

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

// ── Error handler (must be last) ──
app.use(errorHandler)

module.exports = app
