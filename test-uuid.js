const crypto = require('crypto')
function generateSyntheticId(name) {
  const hash = crypto.createHash('md5').update((name || '').toLowerCase().trim()).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}
console.log(generateSyntheticId('Radiohead'))
