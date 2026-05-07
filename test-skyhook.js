const mb = require('./src/providers/musicbrainz.provider.js')
mb.lookupArtistById('87c5dedd-371d-4a53-9f7f-80522fb7f3cb').then(console.log).catch(console.error)
