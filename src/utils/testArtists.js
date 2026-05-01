// Rotating test-artist pool for verification harnesses.
//
// Selection is deterministic per calendar day (UTC): the same artist is
// returned for every call within a day, and the pool advances by one
// position each day. This serves two purposes:
//   1. The harness never accidentally exercises only one artist's data
//      path day-after-day, which would mask provider-specific failures.
//   2. Two harness runs in the same day return the same artist, so a
//      "did the fix help?" comparison is apples-to-apples.

const ARTISTS = [
  'Radiohead',
  'Kendrick Lamar',
  'Daft Punk',
  'Miles Davis',
  'Taylor Swift',
  'Aphex Twin',
  'Metallica',
  'Bad Bunny',
  'Nirvana',
  'Hans Zimmer'
]

function dayOfEpoch (now = Date.now()) {
  return Math.floor(now / 86400000)
}

function getNextArtist () {
  return ARTISTS[dayOfEpoch() % ARTISTS.length]
}

// Test helper — pick by explicit day index for deterministic assertions.
function getArtistForDay (day) {
  const n = ARTISTS.length
  return ARTISTS[((day % n) + n) % n]
}

function getPoolSize () {
  return ARTISTS.length
}

function getPool () {
  return ARTISTS.slice()
}

module.exports = { getNextArtist, getArtistForDay, getPoolSize, getPool }
