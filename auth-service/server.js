const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const app = express()

const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret'

app.use(express.json())

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// Mock Database of users (password is "password" hashed)
const MOCK_PASSWORD_HASH = '$2b$10$Ep3G1.7P3iI9S1G1Fw9rL.p./R.fWvM/JjI/jW0jO1x8hK/JjP1Kq' // bcrypt hash for "password"
const users = {
  admin: { username: 'admin', role: 'admin', passwordHash: MOCK_PASSWORD_HASH },
  viewer: { username: 'viewer', role: 'viewer', passwordHash: MOCK_PASSWORD_HASH }
}

// Observability state
const startTime = Date.now()
const stats = {
  requests: { total: 0 },
  errors: { count: 0 },
  cache: { hits: 0, misses: 0 }
}
const history = []
const requestTimestamps = []

// Metrics Middleware
app.use((req, res, next) => {
  stats.requests.total++
  const now = Date.now()
  requestTimestamps.push(now)
  const oneMinAgo = now - 60000
  while (requestTimestamps.length > 0 && requestTimestamps[0] < oneMinAgo) {
    requestTimestamps.shift()
  }

  res.on('finish', () => {
    if (res.statusCode >= 400) stats.errors.count++
  })
  next()
})

setInterval(() => {
  const errorRate = stats.requests.total > 0 ? Number((stats.errors.count / stats.requests.total).toFixed(4)) : 0
  history.push({
    timestamp: new Date().toISOString(),
    requestsPerMinute: requestTimestamps.length,
    latencyAvgMs: 0, // Simplified for mock
    errorRate
  })
  if (history.length > 10) history.shift()
}, 60000)

// --- Auth Endpoints ---

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' })
  }

  const user = users[username]
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const match = await bcrypt.compare(password, user.passwordHash)
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const token = jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  )

  res.json({ token })
})

app.get('/api/auth/validate', (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    res.json({
      valid: true,
      user: {
        username: decoded.username,
        role: decoded.role
      }
    })
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' })
  }
})

// --- Observability Endpoints ---

app.get('/api/health', (req, res) => {
  const memoryUsage = process.memoryUsage()
  const memoryMb = Math.round(memoryUsage.rss / 1024 / 1024)
  res.json({
    status: 'ok',
    proxy: 'running',
    upstream: 'ok',
    cache: 'ok',
    memory: {
      status: memoryMb > 300 ? 'warning' : 'ok',
      usageMb: memoryMb
    },
    uptime: process.uptime(),
    lastQueryAt: new Date().toISOString()
  })
})

app.get('/api/stats', (req, res) => {
  const errorRate = stats.requests.total > 0 ? Number((stats.errors.count / stats.requests.total).toFixed(4)) : 0
  res.json({
    startedAt: new Date(startTime).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    requests: {
      total: stats.requests.total,
      perMinute: requestTimestamps.length
    },
    cache: { hits: 0, misses: 0, hitRate: 0 },
    latency: { avgMs: 0, p95Ms: 0 },
    errors: { count: stats.errors.count, rate: errorRate },
    topQueries: []
  })
})

app.get('/api/stats/history', (req, res) => {
  res.json({ history })
})

app.get('/api/version', (req, res) => {
  res.json({
    app: process.env.APP_NAME || 'Auth Service',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  })
})

// Fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth Service listening on port ${PORT}`)
})
