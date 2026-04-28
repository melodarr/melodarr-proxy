function calculateTextMatch (query, artistName) {
  if (!query || !artistName) return 0.0

  const exact = query.trim()
  const artist = artistName.trim()

  if (exact === artist) return 1.0

  const q = exact.toLowerCase()
  const a = artist.toLowerCase()

  if (q === a) return 0.9

  if (a.includes(q) || q.includes(a)) return 0.6

  const qWords = q.split(/\s+/)
  const aWords = a.split(/\s+/)
  if (qWords.some(w => aWords.includes(w))) return 0.3

  return 0.0
}

function rankResults (input) {
  if (!input || !Array.isArray(input.results)) {
    throw new Error('Invalid input: must contain results array')
  }

  const { query, results } = input
  const rankedResults = []
  const debugData = { scores: [], rankingFactors: {} }

  for (const result of results) {
    const textMatch = calculateTextMatch(query, result.artistName)
    const confidence = typeof result.confidence === 'number' ? result.confidence : 0

    // Popularity proxy
    const albumCount = Array.isArray(result.albums) ? result.albums.length : 0
    const providerCount = Array.isArray(result.providerSources) ? result.providerSources.length : 1

    const albumScore = Math.min(albumCount / 20, 1.0)
    const providerScore = Math.min(providerCount / 3, 1.0)
    const popularity = (albumScore * 0.7) + (providerScore * 0.3)

    // Data Completeness
    let completeness = 0
    if (albumCount > 0) {
      const albumsWithYear = result.albums.filter(a => a.firstReleaseDate || a.year).length
      completeness = albumsWithYear / albumCount
    }

    // Score function
    const score = (textMatch * 0.4) + (confidence * 0.3) + (popularity * 0.2) + (completeness * 0.1)

    const rankedResult = {
      ...result,
      score: Number(score.toFixed(4))
    }

    // Rank albums internally by completeness/year if needed,
    // but the prompt mainly focuses on artist relevance.
    // We'll leave albums as is.

    rankedResults.push(rankedResult)

    debugData.scores.push(rankedResult.score)
    debugData.rankingFactors[result.artistName || 'unknown'] = {
      textMatch,
      confidence,
      popularity,
      completeness,
      raw: {
        albumCount,
        providerCount
      }
    }
  }

  rankedResults.sort((a, b) => b.score - a.score)

  return {
    results: rankedResults,
    debug: debugData
  }
}

module.exports = { rankResults }
