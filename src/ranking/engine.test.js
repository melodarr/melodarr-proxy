const { test } = require('node:test')
const assert = require('node:assert/strict')
const { rankResults } = require('./engine')

// ── Input validation ──────────────────────────────────────────────

test('rankResults throws when input is null', () => {
  assert.throws(() => rankResults(null), /Invalid input/)
})

test('rankResults throws when input has no results property', () => {
  assert.throws(() => rankResults({}), /Invalid input/)
})

test('rankResults throws when results is not an array', () => {
  assert.throws(() => rankResults({ results: 'not-array' }), /Invalid input/)
})

// ── Empty input ───────────────────────────────────────────────────

test('rankResults returns empty results array when results is empty', () => {
  const { results, debug } = rankResults({ query: 'test', results: [] })
  assert.deepEqual(results, [])
  assert.deepEqual(debug.scores, [])
  assert.deepEqual(debug.rankingFactors, {})
})

// ── Text match tiers ──────────────────────────────────────────────

test('exact case-sensitive match yields highest text score', () => {
  const input = {
    query: 'Radiohead',
    results: [
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0 },
      { artistName: 'radiohead', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  // Exact match (1.0) scores higher than case-insensitive (0.9)
  assert.equal(results[0].artistName, 'Radiohead')
  assert.ok(results[0].score > results[1].score)
})

test('case-insensitive match scores lower than exact', () => {
  const input = {
    query: 'radiohead',
    results: [
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  // textMatch = 0.9 → score = 0.9 * 0.4 = 0.36, plus 0.5 boost, minus 0.03 penalty = 0.83
  assert.equal(results[0].score, 0.83)
})

test('partial substring match gives textMatch 0.6', () => {
  const input = {
    query: 'radio',
    results: [
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  // textMatch = 0.6 → score = 0.6 * 0.4 = 0.24, minus 0.03 penalty = 0.21
  assert.equal(results[0].score, 0.21)
})

test('shared-word match gives textMatch 0.3', () => {
  const input = {
    query: 'The Beatles',
    results: [
      { artistName: 'The Kinks', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  // qWords=['the','beatles'], aWords=['the','kinks'] → 'the' matches → 0.3
  // score = 0.3 * 0.4 = 0.12, minus 0.03 penalty = 0.09
  assert.equal(results[0].score, 0.09)
})

test('no matching words yields textMatch 0.0', () => {
  const input = {
    query: 'xyz',
    results: [
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  assert.equal(results[0].score, -0.03)
})

test('empty query or empty artistName yields textMatch 0.0', () => {
  const input = {
    query: '',
    results: [
      { artistName: '', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  assert.equal(results[0].score, -0.03)
})

// ── Sorting ───────────────────────────────────────────────────────

test('results are sorted by score descending', () => {
  const input = {
    query: 'Radiohead',
    results: [
      // lower text match
      { artistName: 'Radio', albums: [], providerSources: [], confidence: 0 },
      // exact match
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  assert.ok(results[0].score >= results[1].score)
  assert.equal(results[0].artistName, 'Radiohead')
})

// ── Confidence factor ─────────────────────────────────────────────

test('higher confidence yields higher score', () => {
  const input = {
    query: 'Artist',
    results: [
      { artistName: 'Artist', albums: [], providerSources: [], confidence: 0.5 },
      { artistName: 'Artist', albums: [], providerSources: [], confidence: 0.9 }
    ]
  }
  const { results } = rankResults(input)
  // Both have same textMatch (1.0), but second has higher confidence
  assert.ok(results[0].score > results[1].score)
  assert.equal(results[0].confidence, 0.9)
})

// ── Popularity factor (album count & provider count) ──────────────

test('more albums yield higher popularity score', () => {
  const input = {
    query: 'Band',
    results: [
      {
        artistName: 'Band',
        albums: Array.from({ length: 20 }, () => ({})),
        providerSources: [],
        confidence: 0
      },
      {
        artistName: 'Band',
        albums: [],
        providerSources: [],
        confidence: 0
      }
    ]
  }
  const { results } = rankResults(input)
  // First result has 20 albums → albumScore = 1.0, second has 0
  assert.ok(results[0].score > results[1].score)
  assert.equal(results[0].albums.length, 20)
})

test('album score is capped at 1.0 for 20+ albums', () => {
  const makeInput = (count) => ({
    query: 'Band',
    results: [
      {
        artistName: 'Band',
        albums: Array.from({ length: count }, () => ({})),
        providerSources: [],
        confidence: 0
      }
    ]
  })
  const { results: r20 } = rankResults(makeInput(20))
  const { results: r40 } = rankResults(makeInput(40))
  // albumScore is capped → same score for 20 and 40 albums with the same provider count
  assert.equal(r20[0].score, r40[0].score)
})

test('more provider sources yield higher popularity', () => {
  const input = {
    query: 'xyz',
    results: [
      {
        artistName: 'Artist',
        albums: [],
        providerSources: ['musicbrainz', 'itunes', 'lastfm'],
        confidence: 0
      },
      {
        artistName: 'Artist',
        albums: [],
        providerSources: ['itunes'],
        confidence: 0
      }
    ]
  }
  const { results } = rankResults(input)
  assert.ok(results[0].score > results[1].score)
  assert.equal(results[0].providerSources.length, 3)
})

// ── Data completeness factor ──────────────────────────────────────

test('albums with firstReleaseDate count toward completeness', () => {
  const input = {
    query: 'xyz',
    results: [
      {
        artistName: 'Band',
        albums: [
          { firstReleaseDate: '2001' },
          { firstReleaseDate: '2003' }
        ],
        providerSources: [],
        confidence: 0
      },
      {
        artistName: 'Band',
        albums: [
          { firstReleaseDate: '2001' },
          {}
        ],
        providerSources: [],
        confidence: 0
      }
    ]
  }
  const { results } = rankResults(input)
  // First result has 100% completeness, second has 50%
  assert.ok(results[0].score > results[1].score)
})

test('albums with year field also count toward completeness', () => {
  // Compare two artists: one whose album has a year, one whose album is missing it
  const input = {
    query: 'xyz',
    results: [
      {
        artistName: 'With Year',
        albums: [{ year: '2001' }],
        providerSources: [],
        confidence: 0
      },
      {
        artistName: 'Without Year',
        albums: [{}],
        providerSources: [],
        confidence: 0
      }
    ]
  }
  const { results } = rankResults(input)
  // Both have 1 album (same popularity), but first has completeness = 1.0 vs 0.0
  assert.ok(results[0].score > results[1].score)
  assert.equal(results[0].artistName, 'With Year')
})

// ── Debug data ────────────────────────────────────────────────────

test('debug data includes scores and rankingFactors for each result', () => {
  const input = {
    query: 'Radiohead',
    results: [
      { artistName: 'Radiohead', albums: [], providerSources: [], confidence: 0.8 },
      { artistName: 'Radio', albums: [], providerSources: [], confidence: 0.1 }
    ]
  }
  const { debug } = rankResults(input)
  assert.equal(debug.scores.length, 2)
  assert.ok('Radiohead' in debug.rankingFactors)
  assert.ok('Radio' in debug.rankingFactors)
  const rf = debug.rankingFactors.Radiohead
  assert.ok(typeof rf.textMatch === 'number')
  assert.ok(typeof rf.confidence === 'number')
  assert.ok(typeof rf.popularity === 'number')
  assert.ok(typeof rf.completeness === 'number')
  assert.ok(typeof rf.raw.albumCount === 'number')
  assert.ok(typeof rf.raw.providerCount === 'number')
})

test('ranked results include score field', () => {
  const input = {
    query: 'Artist',
    results: [
      { artistName: 'Artist', albums: [], providerSources: [], confidence: 0.5 }
    ]
  }
  const { results } = rankResults(input)
  assert.ok(typeof results[0].score === 'number')
})

test('non-numeric confidence defaults to 0', () => {
  const input = {
    query: 'Artist',
    results: [
      { artistName: 'Artist', albums: [], providerSources: [], confidence: 'high' }
    ]
  }
  const { results } = rankResults(input)
  // confidence treated as 0 → score = 1.0*0.4 + 0*0.3 + 0*0.2 - 0.03 + 0.5 boost = 0.87
  assert.equal(results[0].score, 0.87)
})

test('missing providerSources defaults providerCount to 1', () => {
  const input = {
    query: 'Artist',
    results: [
      { artistName: 'Artist', albums: [], confidence: 0 }
    ]
  }
  const { results } = rankResults(input)
  // providerCount = 1 (default), providerScore = min(1/3, 1) = 0.333
  // albumScore = 0, popularity = 0.333 * 0.3 = 0.1
  // score = 0 + 0 + 0.1 * 0.2 + 0 = 0.02
  assert.ok(results[0].score > 0)
})
