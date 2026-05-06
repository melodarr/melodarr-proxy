const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { rankResults } = require('./engine')

describe('Baseline Ranking Tests (Phase 6)', () => {
  test('Given multiple artist candidates -> deterministic order', () => {
    // We provide 3 artists with identical factors so their scores will be identical.
    // We verify that the sorting is stable and deterministic (currently relies on JS stable sort).
    const input = {
      query: 'Artist',
      results: [
        { artistName: 'Artist', id: '3', albums: [], providerSources: ['mb'], confidence: 0.5 },
        { artistName: 'Artist', id: '1', albums: [], providerSources: ['mb'], confidence: 0.5 },
        { artistName: 'Artist', id: '2', albums: [], providerSources: ['mb'], confidence: 0.5 }
      ]
    }
    const { results } = rankResults(input)

    // Scores should all be equal
    assert.equal(results[0].score, results[1].score)
    assert.equal(results[1].score, results[2].score)

    // Current behavior: tie-breaker sorts by ID localeCompare
    assert.equal(results[0].id, '1')
    assert.equal(results[1].id, '2')
    assert.equal(results[2].id, '3')
  })

  test('Given multiple album matches -> deterministic order', () => {
    // engine.js currently leaves albums as is.
    // This locks the current behavior so we can see if we break it.
    const input = {
      query: 'Band',
      results: [
        {
          artistName: 'Band',
          albums: [
            { title: 'Album C', year: '2010' },
            { title: 'Album A', year: '2005' },
            { title: 'Album B', year: '2020' }
          ],
          providerSources: ['mb'],
          confidence: 0.9
        }
      ]
    }
    const { results } = rankResults(input)

    // Check artist
    assert.equal(results[0].artistName, 'Band')

    // Current behavior: albums are unmodified and retain input order.
    assert.equal(results[0].albums.length, 3)
    assert.equal(results[0].albums[0].title, 'Album C')
    assert.equal(results[0].albums[1].title, 'Album A')
    assert.equal(results[0].albums[2].title, 'Album B')
  })

  test('Same input -> same output order every time (Idempotency)', () => {
    const input = {
      query: 'The Rockers',
      results: [
        { artistName: 'The Rockers', albums: [{}, {}], providerSources: ['mb', 'itunes'], confidence: 0.8 },
        { artistName: 'Rockers', albums: [{}], providerSources: ['mb'], confidence: 0.5 },
        { artistName: 'The Rockers Band', albums: Array.from({ length: 10 }, () => ({})), providerSources: ['mb', 'itunes', 'lastfm'], confidence: 0.6 }
      ]
    }

    const run1 = rankResults(JSON.parse(JSON.stringify(input)))
    const run2 = rankResults(JSON.parse(JSON.stringify(input)))
    const run3 = rankResults(JSON.parse(JSON.stringify(input)))

    assert.deepEqual(run1.results.map(r => r.artistName), run2.results.map(r => r.artistName))
    assert.deepEqual(run2.results.map(r => r.artistName), run3.results.map(r => r.artistName))

    // Also assert exact scores are identical
    assert.deepEqual(run1.results.map(r => r.score), run2.results.map(r => r.score))
  })
})
