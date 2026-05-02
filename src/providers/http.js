const https = require('https')

const httpsAgent = new https.Agent({
  keepAlive: true
})

function pickLargestImage (images) {
  if (!Array.isArray(images)) {
    return ''
  }

  const image = [...images].reverse().find((item) => item?.['#text'])
  return image?.['#text'] || ''
}

module.exports = {
  httpsAgent,
  pickLargestImage
}
