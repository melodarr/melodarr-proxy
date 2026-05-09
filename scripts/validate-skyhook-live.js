#!/usr/bin/env node
'use strict'

const baseUrl = (process.argv[2] || process.env.PROXY_URL || `http://127.0.0.1:${process.env.HOST_PORT || '3055'}`).replace(/\/+$/, '')
const allowUpstreamFailure = ['1', 'true', 'yes'].includes(String(process.env.ALLOW_SKYHOOK_UPSTREAM_FAILURE || '').toLowerCase())
const requiredLookupFields = ['foreignArtistId', 'status', 'links', 'aliases']

function fail (message) {
  console.error(`SkyHook lookup contract failed: ${message}`)
  process.exit(1)
}

async function fetchText (url) {
  try {
    const response = await fetch(url)
    const text = await response.text()
    return { response, text }
  } catch (error) {
    return {
      response: { ok: false, status: 0, statusText: 'network error' },
      text: error && error.message ? error.message : String(error)
    }
  }
}

function parseJson (text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function hasBrokenUpstreamSignal (body) {
  return Boolean(
    body &&
    (
      body.status === 'degraded' ||
      body.upstream === 'unreachable' ||
      (body.upstreamDetail && body.upstreamDetail.status === 'unreachable') ||
      (body.network && body.network.musicbrainz && body.network.musicbrainz.ok === false)
    )
  )
}

async function upstreamLooksUnavailable () {
  for (const path of ['/api/ready', '/api/health']) {
    const { response, text } = await fetchText(`${baseUrl}${path}`)
    if (!response.ok) {
      continue
    }

    if (hasBrokenUpstreamSignal(parseJson(text))) {
      return true
    }
  }

  return false
}

async function maybeSkipUpstreamFailure (status, bodyText) {
  if (!allowUpstreamFailure || (status !== 0 && status < 500)) {
    return false
  }

  if (await upstreamLooksUnavailable()) {
    console.warn(`SkyHook live lookup skipped: upstream unavailable in this runtime (HTTP ${status || '000'}).`)
    if (bodyText) {
      console.warn(bodyText.slice(0, 500))
    }
    return true
  }

  return false
}

async function main () {
  const lookupUrl = `${baseUrl}/api/v1/artist/lookup?term=Radiohead`
  const { response, text } = await fetchText(lookupUrl)

  if (!response.ok) {
    if (await maybeSkipUpstreamFailure(response.status, text)) {
      return
    }

    fail(`HTTP ${response.status || '000'} from ${lookupUrl}: ${text.slice(0, 500)}`)
  }

  const body = parseJson(text)
  if (!Array.isArray(body)) {
    fail('expected lookup response to be an array')
  }

  if (body.length === 0) {
    console.log('SkyHook lookup contract passed: empty lookup response accepted')
    return
  }

  const artist = body[0] || {}
  const missing = requiredLookupFields.filter(key => !Object.prototype.hasOwnProperty.call(artist, key))
  if (missing.length > 0) {
    fail(`missing required lookup fields: ${missing.join(', ')}`)
  }

  console.log(`SkyHook lookup contract passed: ${requiredLookupFields.join(', ')}`)
}

main().catch(error => fail(error && error.message ? error.message : String(error)))
