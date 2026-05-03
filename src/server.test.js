const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const express = require('express')
const { Readable, Writable } = require('node:stream')

function mockModule (modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  }
}

function loadServer () {
  const serverPath = require.resolve('./server')
  const cachePath = require.resolve('./cache')
  const upstreamPath = require.resolve('./services/upstream.service')
  const upstreamMonitorPath = require.resolve('./monitors/upstream.monitor')
  const jobsPath = require.resolve('./jobs')
  const metricsMiddlewarePath = require.resolve('./middleware/metrics.middleware')
  const apiRoutesPath = require.resolve('./routes/api.routes')
  const debugRoutesPath = require.resolve('./routes/debug.routes')
  const publicRoutesPath = require.resolve('./routes/public.routes')
  const loggerPath = require.resolve('./utils/logger')
  const logRecords = []

  for (const modulePath of [
    serverPath,
    cachePath,
    upstreamPath,
    upstreamMonitorPath,
    jobsPath,
    metricsMiddlewarePath,
    apiRoutesPath,
    debugRoutesPath,
    publicRoutesPath,
    loggerPath
  ]) {
    delete require.cache[modulePath]
  }

  const apiRoutes = express.Router()
  apiRoutes.get('/health', (_req, res) => res.json({ status: 'ok' }))
  const debugRoutes = express.Router()
  const publicRoutes = express.Router()
  publicRoutes.get('/artist/search', (_req, res) => res.json([{ artistName: 'Public Artist', id: '', albums: [] }]))

  mockModule(cachePath, {
    async isReady () {
      return true
    }
  })
  mockModule(upstreamPath, {
    async checkHealth () {
      return true
    },
    async probe () {
      return { status: 'healthy', error: null }
    }
  })
  mockModule(upstreamMonitorPath, {
    async runCheck () {
      return { status: 'healthy', lastCheckedAt: new Date().toISOString(), lastError: null, consecutiveFailures: 0 }
    },
    getStatus () {
      return { status: 'healthy', lastCheckedAt: new Date().toISOString(), lastError: null, consecutiveFailures: 0 }
    },
    start () {},
    stop () {}
  })
  mockModule(jobsPath, {
    startJobs () {}
  })
  mockModule(metricsMiddlewarePath, (_req, _res, next) => next())
  mockModule(apiRoutesPath, apiRoutes)
  mockModule(debugRoutesPath, debugRoutes)
  mockModule(publicRoutesPath, publicRoutes)
  mockModule(loggerPath, {
    info (message, meta) { logRecords.push({ level: 'info', message, meta }) },
    warn (message, meta) { logRecords.push({ level: 'warn', message, meta }) },
    error (message, meta) { logRecords.push({ level: 'error', message, meta }) }
  })

  const originalNoListen = process.env.NO_LISTEN
  process.env.NO_LISTEN = '1'
  const serverModule = require('./server')
  const app = typeof serverModule === 'function' ? serverModule : serverModule.createApp()
  process.env.NO_LISTEN = originalNoListen
  app.response.sendFile = function sendFileForTest (filePath) {
    this.type('html')
    this.send(fs.readFileSync(filePath, 'utf8'))
  }

  return { app, logRecords }
}

function normalizeHeaders (headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
}

function invokeApp (app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({ read () {} })
    req.url = path
    req.method = options.method || 'GET'
    req.headers = normalizeHeaders(options.headers || {})
    if (!req.headers.host) {
      req.headers.host = '127.0.0.1'
    }
    req.connection = {}
    req.socket = {}
    req.push(null)

    const chunks = []
    const headers = {}
    const res = new Writable({
      write (chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      }
    })

    res.statusCode = 200
    res.setHeader = (key, value) => {
      headers[key.toLowerCase()] = value
    }
    res.getHeader = (key) => headers[key.toLowerCase()]
    res.getHeaders = () => headers
    res.removeHeader = (key) => {
      delete headers[key.toLowerCase()]
    }
    res.writeHead = (statusCode, responseHeaders = {}) => {
      res.statusCode = statusCode
      for (const [key, value] of Object.entries(responseHeaders)) {
        res.setHeader(key, value)
      }
      return res
    }

    const originalEnd = res.end.bind(res)
    res.end = (chunk, encoding, callback) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      }
      originalEnd(callback)
      resolve({
        statusCode: res.statusCode,
        headers,
        text: Buffer.concat(chunks).toString('utf8'),
        json () {
          return JSON.parse(this.text)
        }
      })
      return res
    }

    app.handle(req, res, reject)
  })
}

test('proxy exposes API metadata on /api/info', async (t) => {
  const { app } = loadServer()
  const response = await invokeApp(app, '/api/info')
  const body = response.json()

  assert.equal(response.statusCode, 200)
  assert.equal(body.app, 'Melodarr Proxy')
  assert.equal(body.role, 'api')
  assert.equal(body.docs, '/docs')
  assert.equal(body.openapi, '/openapi.json')
  assert.equal(body.health, '/api/health')
})

test('public API CORS remains wildcard', async (t) => {
  const { app } = loadServer()
  const response = await invokeApp(app, '/api/info', {
    headers: { Origin: 'https://untrusted.example' }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['access-control-allow-origin'], '*')
})

test('operator CORS rejects untrusted preflight origins', async (t) => {
  const { app } = loadServer()
  const response = await invokeApp(app, '/api/settings', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      Host: 'proxy.local'
    }
  })

  assert.equal(response.statusCode, 403)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('operator CORS allows same-origin preflight with credentials', async (t) => {
  const { app } = loadServer()
  const response = await invokeApp(app, '/api/settings', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://proxy.local',
      Host: 'proxy.local'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['access-control-allow-origin'], 'http://proxy.local')
  assert.equal(response.headers['access-control-allow-credentials'], 'true')
  assert.match(response.headers['access-control-allow-headers'], /X-CSRF-Token/)
})

test('proxy exposes Scalar docs and OpenAPI JSON', async (t) => {
  const { app } = loadServer()
  const docsResponse = await invokeApp(app, '/docs')
  const openApiResponse = await invokeApp(app, '/openapi.json')
  const openApiBody = openApiResponse.json()

  assert.equal(docsResponse.statusCode, 200)
  assert.match(docsResponse.headers['content-type'] || '', /text\/html/)
  const docsBody = docsResponse.text
  assert.match(docsBody, /@scalar\/api-reference/)
  assert.match(docsBody, /\/openapi\.json/)

  assert.equal(openApiResponse.statusCode, 200)
  assert.equal(openApiBody.openapi, '3.1.0')
  assert.equal(openApiBody.info.title, 'Melodarr Proxy API')
  assert.ok(openApiBody.paths['/api/v1/artist/lookup'])
})

test('proxy serves operator dashboard aliases', async (t) => {
  const { app } = loadServer()
  const dashboardResponse = await invokeApp(app, '/dashboard')
  const settingsResponse = await invokeApp(app, '/settings')
  const statsResponse = await invokeApp(app, '/stats')
  const loginResponse = await invokeApp(app, '/login')

  assert.equal(dashboardResponse.statusCode, 200)
  assert.match(dashboardResponse.headers['content-type'] || '', /text\/html/)
  assert.match(dashboardResponse.text, /Melodarr Proxy/)

  assert.equal(settingsResponse.statusCode, 200)
  assert.match(settingsResponse.text, /Runtime config/)

  assert.equal(statsResponse.statusCode, 200)
  assert.match(statsResponse.text, /Runtime counters/)

  assert.equal(loginResponse.statusCode, 200)
  assert.match(loginResponse.text, /Melodarr Proxy/)
})

test('proxy mounts legacy /artist/search compatibility route', async (t) => {
  const { app } = loadServer()
  const response = await invokeApp(app, '/artist/search?term=radiohead&apikey=mp_secret')
  const body = response.json()

  assert.equal(response.statusCode, 200)
  assert.equal(body[0].artistName, 'Public Artist')
})

test('proxy logs unmatched route details without sensitive query keys', async (t) => {
  const { app, logRecords } = loadServer()
  const response = await invokeApp(app, '/api/mp_secret/missing/path?term=radiohead&apikey=mp_secret&token=hidden')
  const body = response.json()
  const routeLog = logRecords.find(record => record.level === 'warn' && record.message === 'Route not found')

  assert.equal(response.statusCode, 404)
  assert.equal(body.error, 'API route not found')
  assert.ok(routeLog)
  assert.equal(routeLog.meta.method, 'GET')
  assert.equal(routeLog.meta.originalUrl, '/api/[redacted-api-key]/missing/path?term=radiohead&apikey=mp_secret&token=hidden')
  assert.equal(routeLog.meta.path, '/api/[redacted-api-key]/missing/path')
  assert.deepEqual(routeLog.meta.queryKeys, ['term'])
})

test('proxy logs unmatched legacy path-key routes with hex key redacted', async (t) => {
  const { app, logRecords } = loadServer()
  const legacyKey = 'bc57be1e98bed038597f1fed0f058137'
  const response = await invokeApp(app, `/api/${legacyKey}/v1/artist/lookup/typo?term=radiohead`)
  const routeLog = logRecords.find(record => record.level === 'warn' && record.message === 'Route not found')

  assert.equal(response.statusCode, 404)
  assert.ok(routeLog)
  assert.equal(routeLog.meta.originalUrl, '/api/[redacted-api-key]/v1/artist/lookup/typo?term=radiohead')
  assert.equal(routeLog.meta.path, '/api/[redacted-api-key]/v1/artist/lookup/typo')
  assert.ok(!JSON.stringify(routeLog).includes(legacyKey))
})
