const test = require('node:test')
const assert = require('node:assert/strict')

const { isValidArtist } = require('./validateArtist')

// ── falsy / non-object inputs ─────────────────────────────────────

test('isValidArtist — null/undefined/non-object → false', () => {
  assert.equal(isValidArtist(null), false)
  assert.equal(isValidArtist(undefined), false)
  assert.equal(isValidArtist('string'), false)
  assert.equal(isValidArtist(42), false)
  assert.equal(isValidArtist([]), false)
})

test('isValidArtist — empty object → false', () => {
  assert.equal(isValidArtist({}), false)
})

// ── SkyHook wrapped artist ────────────────────────────────────────

test('isValidArtist — wrapped artist with artistName and foreignArtistId → true', () => {
  assert.equal(isValidArtist({ artist: { artistName: 'Whitesnake', foreignArtistId: 'mb-1' } }), true)
})

test('isValidArtist — wrapped artist with empty artistName → false', () => {
  assert.equal(isValidArtist({ artist: { artistName: '' } }), false)
})

test('isValidArtist — wrapped artist with whitespace artistName → false', () => {
  assert.equal(isValidArtist({ artist: { artistName: '   ' } }), false)
})

test('isValidArtist — wrapped artist with null artistName → false', () => {
  assert.equal(isValidArtist({ artist: { artistName: null } }), false)
})

test('isValidArtist — wrapped artist with missing or empty foreignArtistId is invalid', () => {
  assert.equal(isValidArtist({ artist: { artistName: 'X', foreignArtistId: '' } }), false)
  assert.equal(isValidArtist({ artist: { artistName: 'X', foreignArtistId: '   ' } }), false)
  assert.equal(isValidArtist({ artist: { artistName: 'X' } }), false)
  assert.equal(isValidArtist({ artist: { artistName: 'X', foreignArtistId: undefined } }), false)
})

test('isValidArtist — strict SkyHook wrapped artist accepts id instead of foreignArtistId', () => {
  assert.equal(isValidArtist({ artist: { artistName: 'X', id: 'mb-1' } }), true)
})

// ── SkyHook wrapped album ─────────────────────────────────────────

test('isValidArtist — wrapped album with title and artistId → true', () => {
  // The spec's combined check would have falsely rejected this because
  // album.artistName is undefined and `undefined == null` is true.
  // This test guards against that regression.
  assert.equal(isValidArtist({ album: { title: 'OK Computer', artistId: 'mb-1' } }), true)
})

test('isValidArtist — wrapped album with missing artistId → false', () => {
  assert.equal(isValidArtist({ album: { title: 'OK Computer' } }), false)
})

test('isValidArtist — wrapped album with empty artistId → false', () => {
  assert.equal(isValidArtist({ album: { title: 'OK Computer', artistId: '' } }), false)
})

test('isValidArtist — wrapped album with whitespace artistId → false', () => {
  assert.equal(isValidArtist({ album: { title: 'OK Computer', artistId: '   ' } }), false)
})

test('isValidArtist — wrapped album with empty title → false', () => {
  assert.equal(isValidArtist({ album: { title: '' } }), false)
})

test('isValidArtist — wrapped album with no title → false', () => {
  assert.equal(isValidArtist({ album: { id: 'mb-1' } }), false)
})

// ── Unwrapped lookup-shape artist ─────────────────────────────────

test('isValidArtist — unwrapped lookup artist with artistName and foreignArtistId → true', () => {
  assert.equal(isValidArtist({ artistName: 'Radiohead', foreignArtistId: 'mb-1', albums: [] }), true)
})

test('isValidArtist — unwrapped lookup artist with missing/empty/whitespace foreignArtistId → false', () => {
  assert.equal(isValidArtist({ artistName: 'X', albums: [] }), false)
  assert.equal(isValidArtist({ artistName: 'X', foreignArtistId: '', albums: [] }), false)
  assert.equal(isValidArtist({ artistName: 'X', foreignArtistId: '   ', albums: [] }), false)
})

test('isValidArtist — strict SkyHook unwrapped artist accepts id instead of foreignArtistId', () => {
  assert.equal(isValidArtist({ artistName: 'X', id: 'mb-1', albums: [] }), true)
})

test('isValidArtist — unwrapped lookup artist with empty artistName → false', () => {
  assert.equal(isValidArtist({ artistName: '', albums: [] }), false)
})

// ── Hybrid / edge cases ───────────────────────────────────────────

test('isValidArtist — wrapped artist takes precedence over unwrapped fields', () => {
  // If both .artist and a top-level artistName exist, validate the
  // wrapped form (the SkyHook wrapper is the canonical shape).
  assert.equal(
    isValidArtist({ artist: { artistName: '' }, artistName: 'Backup' }),
    false
  )
})

test('isValidArtist — neither wrap nor lookup shape → false', () => {
  assert.equal(isValidArtist({ foo: 'bar', score: 100 }), false)
})

test('isValidArtist — non-object .artist value → false', () => {
  assert.equal(isValidArtist({ artist: 'not an object' }), false)
})
