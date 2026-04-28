const https = require('https')

const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4 // Force IPv4 to prevent "Client network socket disconnected before secure TLS connection was established"
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
