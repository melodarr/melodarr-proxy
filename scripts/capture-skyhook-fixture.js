#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const SKYHOOK_BASE = 'https://skyhook.lidarr.audio/v1'
const OUT_DIR = path.join(__dirname, '../src/fixtures/skyhook-raw')

const args = process.argv.slice(2)
const command = args[0]
const param = args[1]

if (!command || !param) {
  console.error('Usage: node capture-skyhook-fixture.js <lookup|artist|album> <term_or_id>')
  process.exit(1)
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

async function fetchSkyhook (url) {
  console.log(`Fetching from ${url} ...`)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Lidarr/1.0.0 (https://github.com/lidarr/Lidarr)',
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Skyhook returned ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    return JSON.stringify(parsed, null, 2)
  } catch (e) {
    throw new Error('Skyhook did not return valid JSON: ' + text.slice(0, 200))
  }
}

async function main () {
  let url = ''
  let filename = ''

  if (command === 'lookup') {
    url = `${SKYHOOK_BASE}/artist/lookup?term=${encodeURIComponent(param)}`
    filename = `lookup-${param.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
  } else if (command === 'artist') {
    url = `${SKYHOOK_BASE}/artist/${param}`
    filename = `artist-${param}.json`
  } else if (command === 'album') {
    url = `${SKYHOOK_BASE}/album/${param}`
    filename = `album-${param}.json`
  } else {
    console.error('Unknown command:', command)
    process.exit(1)
  }

  try {
    const data = await fetchSkyhook(url)
    const outPath = path.join(OUT_DIR, filename)
    fs.writeFileSync(outPath, data, 'utf-8')
    console.log(`Successfully saved fixture to ${outPath}`)
  } catch (err) {
    console.error('Error fetching fixture:', err.message)
    process.exit(1)
  }
}

main()
