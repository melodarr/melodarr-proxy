const { handleArtistById } = require('./src/controllers/proxy.controller')

const req = {
  params: { foreignArtistId: '87c5dedd-371d-4a53-9f7f-80522fb7f3cb' },
  query: {},
  app: {
    get: (key) => {
      if (key === 'tracer') return { createTrace: () => ({ info: console.log, warn: console.log, error: console.log, end: console.log }) }
      if (key === 'cache') return { get: async () => null, set: async () => {}, setStale: async () => {} }
      if (key === 'db') return { get: () => ({ metadataProviders: ['musicbrainz'] }) }
      if (key === 'settings') return { get: () => ({ metadataProviders: ['musicbrainz'] }) }
    }
  }
}

const res = {
  json: (data) => console.log(JSON.stringify(data, null, 2)),
  status: (code) => {
    console.log('Status:', code)
    return res
  }
}

handleArtistById(req, res).catch(console.error)
