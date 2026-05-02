const { aggregateArtist } = require('./src/providers/index');
const axios = require('axios');

// Mock axios
require.cache[require.resolve('axios')] = {
  exports: {
    get: async (url, config) => {
      if (url.includes('lastfm') && url.includes('artist.getinfo')) {
        return { data: { artist: { mbid: '12345-lastfm' } } };
      }
      if (url.includes('lastfm') && url.includes('artist.gettopalbums')) {
        return { data: { topalbums: { '@attr': { artist: 'Radiohead' }, album: [] } } };
      }
      if (url.includes('theaudiodb') && url.includes('search.php')) {
        return { data: { artists: [{ strArtist: 'Radiohead', idArtist: 'adb1', strMusicBrainzID: '12345-adb' }] } };
      }
      if (url.includes('theaudiodb') && url.includes('searchalbum.php')) {
        return { data: { album: [] } };
      }
      if (url.includes('musicbrainz')) {
        throw new Error('MB is down');
      }
      return { data: {} };
    }
  }
};

aggregateArtist('Radiohead').then(data => {
  console.log("Extracted ID:", data.id);
}).catch(console.error);
