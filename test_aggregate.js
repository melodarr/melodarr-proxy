// removed dotenv
const { aggregateArtist } = require('./src/providers/index');

aggregateArtist('Radiohead').then(data => {
  console.log("ID:", data.id);
  console.log("foreignArtistId:", data.id || '');
  console.log("providers:", data.providers);
}).catch(console.error);
