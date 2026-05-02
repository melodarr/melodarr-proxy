const lastfm = require('./src/providers/lastfm.provider');
lastfm.searchArtist('Radiohead').then(console.log).catch(console.error);
