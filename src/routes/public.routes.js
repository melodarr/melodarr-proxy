const express = require('express')
const router = express.Router()
const apiKeyMiddleware = require('../middleware/apiKey.middleware')
const lidarrArtistResponseMiddleware = require('../middleware/lidarrArtistResponse.middleware')
const proxyStateMiddleware = require('../middleware/proxy.middleware')
const { handleArtistLookup } = require('../controllers/proxy.controller')

router.get('/artist/search', lidarrArtistResponseMiddleware, apiKeyMiddleware, proxyStateMiddleware, handleArtistLookup)

module.exports = router
