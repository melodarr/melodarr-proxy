const test = require('node:test')
const assert = require('node:assert/strict')

const { getNextArtist, getArtistForDay, getPoolSize, getPool } = require('./testArtists')

function withFrozenNow (now, fn) {
  const original = Date.now
  Date.now = () => now
  try { return fn() } finally { Date.now = original }
}

test('testArtists — pool is non-empty and unique', () => {
  const pool = getPool()
  assert.ok(pool.length > 0)
  assert.equal(new Set(pool).size, pool.length, 'no duplicates')
})

test('testArtists — getPoolSize matches pool length', () => {
  assert.equal(getPoolSize(), getPool().length)
})

test('testArtists — getNextArtist deterministic within a single calendar day (UTC)', () => {
  const noonDay20000 = 20000 * 86400000 + 12 * 3600000
  let chosen
  withFrozenNow(noonDay20000, () => {
    chosen = getNextArtist()
  })
  // Different time same day → same pick.
  withFrozenNow(noonDay20000 + 6 * 3600000, () => {
    assert.equal(getNextArtist(), chosen)
  })
})

test('testArtists — getNextArtist rotates across days', () => {
  const day20000 = 20000 * 86400000
  const a = withFrozenNow(day20000, () => getNextArtist())
  const b = withFrozenNow(day20000 + 86400000, () => getNextArtist())
  assert.notEqual(a, b)
})

test('testArtists — full pool cycle returns to start', () => {
  const day0 = 20000 * 86400000
  const cycle = []
  for (let i = 0; i < getPoolSize(); i++) {
    cycle.push(withFrozenNow(day0 + i * 86400000, () => getNextArtist()))
  }
  assert.equal(new Set(cycle).size, getPoolSize(), 'full cycle hits every artist exactly once')
  const wrapped = withFrozenNow(day0 + getPoolSize() * 86400000, () => getNextArtist())
  assert.equal(wrapped, cycle[0], 'pool wraps')
})

test('testArtists — getArtistForDay handles negative and large indices', () => {
  const size = getPoolSize()
  assert.equal(getArtistForDay(0), getArtistForDay(size))
  assert.equal(getArtistForDay(0), getArtistForDay(2 * size))
  assert.equal(getArtistForDay(-1), getArtistForDay(size - 1), 'negative wraps')
})
