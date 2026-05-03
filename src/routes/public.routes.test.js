const assert = require('node:assert/strict')
const test = require('node:test')

test('legacy public routes normalize Lidarr artist JSON before route handlers', () => {
  const router = require('./public.routes')
  const [middlewareLayer, routeLayer] = router.stack

  assert.equal(middlewareLayer.name, 'lidarrArtistResponseMiddleware')
  assert.equal(routeLayer.route.path, '/artist/search')
  assert.equal(routeLayer.route.methods.get, true)
})
