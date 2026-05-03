const express = require('express')
const router = express.Router()
const apiKeyMiddleware = require('../middleware/apiKey.middleware')
const lidarrArtistResponseMiddleware = require('../middleware/lidarrArtistResponse.middleware')
const proxyStateMiddleware = require('../middleware/proxy.middleware')
const { handleArtistLookup } = require('../controllers/proxy.controller')

router.use(lidarrArtistResponseMiddleware)

router.get('/artist/search', apiKeyMiddleware, proxyStateMiddleware, handleArtistLookup)

module.exports = router
