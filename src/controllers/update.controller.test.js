const assert = require('node:assert/strict')
const test = require('node:test')
const { after } = require('node:test')

let mockExecFile = null
let mockExistsSync = null
let mockHttpsGet = null

function loadController () {
  const controllerPath = require.resolve('./update.controller')
  const cpPath = require.resolve('child_process')
  const fsPath = require.resolve('fs')
  const httpsPath = require.resolve('https')

  delete require.cache[controllerPath]
  delete require.cache[cpPath]
  delete require.cache[fsPath]
  delete require.cache[httpsPath]

  require.cache[cpPath] = {
    id: cpPath,
    filename: cpPath,
    loaded: true,
    exports: {
      ...require('child_process'),
      execFile: (cmd, args, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts
        }
        if (mockExecFile) {
          return mockExecFile(cmd, args, cb)
        }
        cb(new Error('unmocked execFile'), '', '')
      }
    }
  }

  require.cache[fsPath] = {
    id: fsPath,
    filename: fsPath,
    loaded: true,
    exports: {
      ...require('fs'),
      existsSync: (p) => {
        if (mockExistsSync) return mockExistsSync(p)
        return false
      }
    }
  }

  require.cache[httpsPath] = {
    id: httpsPath,
    filename: httpsPath,
    loaded: true,
    exports: {
      ...require('https'),
      get: (url, options, cb) => {
        if (typeof options === 'function') {
          cb = options
        }
        if (mockHttpsGet) return mockHttpsGet(url, cb)
        const req = {
          on: () => {},
          setTimeout: (timeout, timeoutCb) => {},
          destroy: () => {}
        }
        return req
      }
    }
  }

  return require('./update.controller')
}

after(() => {
  const paths = [
    './update.controller', 'child_process', 'fs', 'https'
  ].map(p => {
    try { return require.resolve(p) } catch (_) { return null }
  }).filter(Boolean)
  for (const p of paths) {
    delete require.cache[p]
  }
})

test('compareVersions handles release tag prefixes and semver parts', () => {
  const { compareVersions } = loadController()
  assert.equal(compareVersions('v0.3.0', '0.2.0'), 1)
  assert.equal(compareVersions('0.2.0', 'v0.2.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

test('buildUpdateStatus returns status when update is available', async () => {
  process.env.APP_VERSION = '0.1.0'

  mockHttpsGet = (url, cb) => {
    const res = {
      statusCode: 200,
      setEncoding: () => {},
      on: (event, handler) => {
        if (event === 'data') {
          handler(JSON.stringify({ tag_name: 'v0.2.0', body: 'changelog' }))
        }
        if (event === 'end') handler()
      }
    }
    cb(res)
    return { on: () => {}, setTimeout: () => {}, destroy: () => {} }
  }

  mockExistsSync = () => true
  mockExecFile = (cmd, args, cb) => {
    cb(null, { stdout: 'mock stdout', stderr: '' })
  }

  const { buildUpdateStatus } = loadController()
  const status = await buildUpdateStatus()

  assert.equal(status.currentVersion, '0.1.0')
  assert.equal(status.latest.version, '0.2.0')
  assert.equal(status.updateAvailable, true)
  assert.equal(status.runner.enabled, true)
  assert.equal(status.error, null)
})

test('buildUpdateStatus handles GitHub API error', async () => {
  process.env.APP_VERSION = '0.1.0'
  mockHttpsGet = (url, cb) => {
    const res = {
      statusCode: 500,
      setEncoding: () => {},
      on: (event, handler) => {
        if (event === 'end') handler()
      }
    }
    cb(res)
    return { on: () => {}, setTimeout: () => {}, destroy: () => {} }
  }

  const { buildUpdateStatus } = loadController()
  const status = await buildUpdateStatus()
  assert.equal(status.updateAvailable, false)
  assert.match(status.error, /GitHub returned 500/)
})

test('getUpdateStatus sends JSON response', async () => {
  process.env.APP_VERSION = '0.2.0'
  mockHttpsGet = (url, cb) => {
    const res = {
      statusCode: 200,
      setEncoding: () => {},
      on: (event, handler) => {
        if (event === 'data') handler(JSON.stringify({ tag_name: 'v0.2.0' }))
        if (event === 'end') handler()
      }
    }
    cb(res)
    return { on: () => {}, setTimeout: () => {}, destroy: () => {} }
  }
  mockExistsSync = () => false // disables runner

  const { getUpdateStatus } = loadController()
  let jsonCalledWith = null
  const res = { json: (data) => { jsonCalledWith = data } }

  await getUpdateStatus({}, res)
  assert.equal(jsonCalledWith.updateAvailable, false)
  assert.equal(jsonCalledWith.runner.enabled, false)
})

test('applyUpdate returns 409 if runner is not enabled', async () => {
  mockExistsSync = () => false
  const { applyUpdate } = loadController()

  let statusCode = null
  let jsonCalledWith = null
  const res = {
    status: (code) => { statusCode = code; return res },
    json: (data) => { jsonCalledWith = data }
  }

  await applyUpdate({}, res)
  assert.equal(statusCode, 409)
  assert.equal(jsonCalledWith.ok, false)
})

test('applyUpdate returns success when already up to date', async () => {
  process.env.APP_VERSION = '0.2.0'
  mockExistsSync = () => true
  mockExecFile = (cmd, args, cb) => cb(null, { stdout: '', stderr: '' })

  const { applyUpdate } = loadController()

  let jsonCalledWith = null
  const res = {
    json: (data) => { jsonCalledWith = data },
    status: (code) => res
  }

  await applyUpdate({}, res)
  assert.equal(jsonCalledWith.ok, true)
  assert.equal(jsonCalledWith.message, 'Already up to date')
})

test('applyUpdate executes steps when update is available', async () => {
  process.env.APP_VERSION = '0.1.0'
  mockExistsSync = () => true
  mockExecFile = (cmd, args, cb) => cb(null, { stdout: 'ok', stderr: '' })

  mockHttpsGet = (url, cb) => {
    const res = {
      statusCode: 200,
      setEncoding: () => {},
      on: (event, handler) => {
        if (event === 'data') handler(JSON.stringify({ tag_name: 'v0.2.0' }))
        if (event === 'end') handler()
      }
    }
    cb(res)
    return { on: () => {}, setTimeout: () => {}, destroy: () => {} }
  }

  const { applyUpdate } = loadController()

  let jsonCalledWith = null
  const res = { json: (data) => { jsonCalledWith = data } }

  await applyUpdate({}, res)
  assert.equal(jsonCalledWith.ok, true)
  assert.equal(jsonCalledWith.steps.length, 4)
  assert.equal(jsonCalledWith.steps[0].name, 'current commit')
})

test('applyUpdate handles exec error', async () => {
  process.env.APP_VERSION = '0.1.0'
  mockExistsSync = () => true
  mockExecFile = (cmd, args, cb) => {
    if (cmd === 'git' && args[0] === 'pull') {
      const err = new Error('merge conflict')
      err.stdout = ''
      err.stderr = 'conflict'
      return cb(err)
    }
    cb(null, { stdout: 'ok', stderr: '' })
  }

  const { applyUpdate } = loadController()

  let statusCode = null
  let jsonCalledWith = null
  const res = {
    status: (code) => { statusCode = code; return res },
    json: (data) => { jsonCalledWith = data }
  }

  await applyUpdate({}, res)
  assert.equal(statusCode, 500)
  assert.equal(jsonCalledWith.ok, false)
  assert.match(jsonCalledWith.error, /merge conflict/)
})
