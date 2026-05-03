const { execFile } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')
const { promisify } = require('util')
const { isAuthenticated } = require('./settings.controller')

const execFileAsync = promisify(execFile)
const DEFAULT_REPOSITORY = 'melodarr/melodarr-proxy'
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000

const { getAppVersion } = require('../utils/version')

function getCurrentVersion () {
  return getAppVersion()
}

function normalizeVersion (version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function compareVersions (a, b) {
  const partsA = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const partsB = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(partsA.length, partsB.length)

  for (let index = 0; index < length; index++) {
    const diff = (partsA[index] || 0) - (partsB[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  return 0
}

function requestJson (url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Melodarr-Proxy/${getCurrentVersion()}`
      }
    }, (response) => {
      let body = ''

      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`GitHub returned ${response.statusCode}`))
        }

        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })

    request.setTimeout(8000, () => {
      request.destroy(new Error('Timed out checking GitHub releases'))
    })
    request.on('error', reject)
  })
}

async function getLatestRelease () {
  const repository = process.env.UPDATE_REPOSITORY || DEFAULT_REPOSITORY
  let release = null

  try {
    const releases = await requestJson(`https://api.github.com/repos/${repository}/releases?per_page=10`)
    if (Array.isArray(releases)) {
      release = releases.find(r => !r.draft && !r.prerelease && r.tag_name && r.tag_name !== 'latest')
    }
  } catch (error) {
    // Fallback if the releases endpoint fails
  }

  if (!release) {
    try {
      release = await requestJson(`https://api.github.com/repos/${repository}/releases/latest`)
    } catch (error) {
      // API completely failed or blocked
    }
  }

  if (release) {
    let version = normalizeVersion(release.tag_name || release.name)
    if (version === 'latest' && release.name) {
      const match = release.name.match(/v?(\d+\.\d+\.\d+)/)
      if (match) version = match[1]
    }

    return {
      repository,
      version,
      tagName: release.tag_name || '',
      name: release.name || release.tag_name || '',
      publishedAt: release.published_at || '',
      changelog: release.body || '',
      htmlUrl: release.html_url || `https://github.com/${repository}/releases`
    }
  }

  // Fallback to git ls-remote origin if API fails completely
  try {
    const projectDir = process.env.UPDATE_PROJECT_DIR || process.cwd()
    const { stdout } = await execFileAsync('git', ['ls-remote', '--tags', 'origin'], { cwd: projectDir, timeout: UPDATE_TIMEOUT_MS })
    const tags = stdout.split('\n')
      .map(line => line.split('refs/tags/')[1])
      .filter(Boolean)
      .filter(tag => !tag.endsWith('^{}'))
      .filter(tag => tag.match(/^v?\d+\.\d+\.\d+/))

    if (tags.length > 0) {
      tags.sort((a, b) => compareVersions(a, b))
      const latestTag = tags[tags.length - 1]
      return {
        repository,
        version: normalizeVersion(latestTag),
        tagName: latestTag,
        name: latestTag,
        publishedAt: '',
        changelog: 'Release notes unavailable (failed to reach GitHub API, used local git reference).',
        htmlUrl: ''
      }
    }
  } catch (error) {
    // Git ls-remote failed
  }

  throw new Error('Unable to check for updates: GitHub API unreachable and git fallback failed.')
}

async function commandAvailable (command, args = ['--version']) {
  try {
    await execFileAsync(command, args, { timeout: 5000 })
    return true
  } catch (_error) {
    return false
  }
}

async function buildUpdateStatus () {
  const currentVersion = normalizeVersion(getCurrentVersion())
  let latest = null
  let checkError = null

  try {
    latest = await getLatestRelease()
  } catch (error) {
    checkError = error.message
  }

  const projectDir = process.env.UPDATE_PROJECT_DIR || process.cwd()
  const hasGitCheckout = fs.existsSync(path.join(projectDir, '.git'))
  const gitAvailable = await commandAvailable('git')
  const dockerAvailable = await commandAvailable('docker')
  const canRunUpdate = hasGitCheckout && gitAvailable && dockerAvailable
  const updateAvailable = Boolean(latest?.version && compareVersions(latest.version, currentVersion) > 0)

  return {
    currentVersion,
    latest,
    updateAvailable,
    checkedAt: new Date().toISOString(),
    runner: {
      enabled: canRunUpdate,
      projectDir,
      gitAvailable,
      dockerAvailable,
      hasGitCheckout,
      reason: canRunUpdate ? null : 'Update runner needs git, Docker Compose, and a mounted project checkout.'
    },
    error: checkError
  }
}

async function getUpdateStatus (req, res) {
  const status = await buildUpdateStatus()

  if (!isAuthenticated(req)) {
    delete status.runner
    delete status.error
  }

  res.json(status)
}

async function runStep (command, args, options) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    ...options,
    timeout: UPDATE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  })

  return {
    command: [command, ...args].join(' '),
    stdout: stdout.trim(),
    stderr: stderr.trim()
  }
}

async function applyUpdate (_req, res) {
  const status = await buildUpdateStatus()

  if (!status.runner.enabled) {
    return res.status(409).json({
      ok: false,
      error: status.runner.reason,
      status
    })
  }

  if (!status.updateAvailable) {
    return res.json({
      ok: true,
      message: 'Already up to date',
      status
    })
  }

  const cwd = status.runner.projectDir
  const startedAt = new Date().toISOString()
  const steps = []

  try {
    const before = await runStep('git', ['rev-parse', 'HEAD'], { cwd })
    steps.push({ name: 'current commit', ...before })

    steps.push({ name: 'fetch', ...(await runStep('git', ['fetch', '--tags', 'origin'], { cwd })) })
    steps.push({ name: 'pull', ...(await runStep('git', ['pull', '--ff-only'], { cwd })) })
    steps.push({ name: 'build and restart', ...(await runStep('docker', ['compose', 'up', '-d', '--build', 'proxy', 'redis', 'melodash'], { cwd })) })

    return res.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      previousCommit: before.stdout,
      steps
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    })
  }
}

module.exports = {
  applyUpdate,
  buildUpdateStatus,
  compareVersions,
  getUpdateStatus
}
