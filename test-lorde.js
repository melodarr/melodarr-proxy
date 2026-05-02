const { aggregateArtist } = require('./src/providers');
async function run() {
  const data = await aggregateArtist('Lorde');
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}
run().catch(console.error);
