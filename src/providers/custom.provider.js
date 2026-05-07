const axios = require('axios')
const { httpsAgent } = require('./http')
const { getConfigValue } = require('../settings/store')

function normalizePath (path) {
  if (!path) return ''
  if (path.startsWith('$')) return path
  return path.startsWith('.') ? `$${path}` : `$.${path}`
}

function tokenizePath (path) {
  const normalized = normalizePath(path).replace(/\[\*\]/g, '[]')
  const trimmed = normalized.replace(/^\$\.?/, '')
  if (!trimmed) return []

  return trimmed.split('.').flatMap((part) => {
    if (part.endsWith('[]')) {
      return [part.slice(0, -2), '*']
    }
    return [part]
  }).filter(Boolean)
}

function readPath (source, path) {
  const tokens = tokenizePath(path)
  let current = source

  for (const token of tokens) {
    if (token === '*') {
      if (!Array.isArray(current)) return undefined
      continue
    }

    if (Array.isArray(current)) {
      current = current.map((item) => item?.[token]).filter((item) => item !== undefined)
    } else {
      current = current?.[token]
    }

    if (current === undefined || current === null) {
      return current
    }
  }

  return current
}

function resolveChildPath (arrayRoot, childPath) {
  if (!arrayRoot || !childPath) return ''
  if (childPath.startsWith('$')) return childPath
  const root = arrayRoot.replace(/\[\*\]$/, '')
  return `${root}[*].${childPath.replace(/^\./, '')}`
}

function mapCustomResponse (raw, mapping = {}) {
  const errors = []
  const warnings = []
  const artistNameValue = readPath(raw, mapping.artistName)
  const artistName = Array.isArray(artistNameValue) ? artistNameValue.find(Boolean) : artistNameValue
  const albumsRoot = readPath(raw, mapping.albums)
  const albumsArray = Array.isArray(albumsRoot) ? albumsRoot : []

  if (!mapping.artistName || artistName === undefined || artistName === null || artistName === '') {
    errors.push({ field: 'artistName', message: 'Path not found or empty' })
  }

  if (!mapping.albums || !Array.isArray(albumsRoot)) {
    errors.push({ field: 'albums', message: 'Path must resolve to an array' })
  } else if (albumsArray.length === 0) {
    warnings.push({ field: 'albums', message: 'Array path matched, but returned no albums' })
  }

  const albums = albumsArray.map((album) => {
    const albumName = readPath(album, mapping.albumName)
    const year = readPath(album, mapping.year)
    const imageUrl = readPath(album, mapping.imageUrl)

    return {
      name: albumName || '',
      year: year ? Number.parseInt(String(year).slice(0, 4), 10) || null : null,
      imageUrl: imageUrl || ''
    }
  }).filter((album) => album.name)

  if (mapping.albumName && albumsArray.length > 0 && albums.length === 0) {
    errors.push({ field: 'albumName', message: 'Path did not produce album names' })
  }

  return {
    mapped: {
      artistName: artistName || '',
      albums
    },
    errors,
    warnings
  }
}

function buildUrl ({ baseUrl, searchPath, queryParam, query }) {
  const url = new URL(searchPath || '', baseUrl)
  if (queryParam && query) {
    url.searchParams.set(queryParam, query)
  }
  return url.toString()
}

function buildHeaders (config) {
  const headers = {}
  const authType = config.authType || 'none'

  if (authType === 'bearer' && config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }

  if (authType === 'header' && config.headerName && config.token) {
    headers[config.headerName] = config.token
  }

  return headers
}

function buildParams (config) {
  if (config.authType === 'query' && config.queryAuthName && config.token) {
    return { [config.queryAuthName]: config.token }
  }
  return {}
}

async function testCustomProvider (body = {}) {
  const config = {
    baseUrl: body.baseUrl,
    searchPath: body.searchPath || '/',
    queryParam: body.queryParam || 'q',
    authType: body.authType || 'none',
    token: body.token,
    headerName: body.headerName,
    queryAuthName: body.queryAuthName,
    mapping: body.mapping || {}
  }

  if (!config.baseUrl) {
    return {
      raw: null,
      mapped: { artistName: '', albums: [] },
      errors: [{ field: 'baseUrl', message: 'Base URL is required' }],
      warnings: []
    }
  }

  const url = buildUrl({ ...config, query: body.query || 'Radiohead' })
  const response = await axios.get(url, {
    headers: buildHeaders(config),
    params: buildParams(config),
    httpsAgent,
    timeout: getConfigValue('upstreamTimeoutMs') || 10000
  })
  const raw = response.data
  const result = mapCustomResponse(raw, config.mapping)

  return {
    raw,
    ...result,
    request: {
      url,
      status: response.status
    }
  }
}

function createCustomProvider (config) {
  return {
    name: config.id,
    searchArtist: async (query) => {
      const url = buildUrl({ ...config, query })
      const response = await axios.get(url, {
        headers: buildHeaders(config),
        params: buildParams(config),
        httpsAgent,
        timeout: getConfigValue('upstreamTimeoutMs') || 10000
      })
      const result = mapCustomResponse(response.data, config.mapping)
      if (result.errors && result.errors.length > 0) {
        throw new Error(`Custom provider mapping failed: ${result.errors.map(e => e.message).join(', ')}`)
      }
      return result.mapped
    }
  }
}

module.exports = {
  mapCustomResponse,
  readPath,
  resolveChildPath,
  testCustomProvider,
  createCustomProvider
}
