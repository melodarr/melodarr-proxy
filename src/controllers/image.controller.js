const axios = require('axios')
const logger = require('../utils/logger')
const { isTrustedImageUrl } = require('../utils/imageProxy')

const IMAGE_TIMEOUT_MS = 15000

function getImageUrl (req) {
  return String(req.query.url || '').trim()
}

function handleImageHead (req, res) {
  const url = getImageUrl(req)
  if (!isTrustedImageUrl(url)) {
    return res.status(400).json({ error: 'Unsupported image URL' })
  }

  res.set('Cache-Control', 'public, max-age=86400')
  res.set('Content-Type', 'image/jpeg')
  return res.status(200).end()
}

async function handleImageProxy (req, res) {
  const url = getImageUrl(req)
  if (!isTrustedImageUrl(url)) {
    return res.status(400).json({ error: 'Unsupported image URL' })
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      timeout: IMAGE_TIMEOUT_MS,
      maxRedirects: 5,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'MelodarrProxy/1.0 (+https://github.com/melodarr/melodarr-proxy)'
      },
      validateStatus: status => status >= 200 && status < 300
    })

    res.set('Cache-Control', 'public, max-age=86400')
    res.set('Content-Type', upstream.headers['content-type'] || 'image/jpeg')
    if (upstream.headers['content-length']) {
      res.set('Content-Length', upstream.headers['content-length'])
    }
    return upstream.data.pipe(res)
  } catch (error) {
    logger.warn('Image proxy fetch failed', {
      url,
      error: error.message,
      status: error.response?.status
    })

    return res.status(error.response?.status || 502).json({
      error: 'Failed to fetch image'
    })
  }
}

module.exports = {
  handleImageHead,
  handleImageProxy
}
