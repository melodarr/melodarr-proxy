const assert = require('node:assert/strict')
const test = require('node:test')

test('legacy public routes normalize Lidarr artist JSON before route handlers', () => {
  const router = require('./public.routes')
  const [routeLayer] = router.stack

  assert.equal(routeLayer.route.path, '/artist/search')
  assert.equal(routeLayer.route.methods.get, true)
  assert.equal(routeLayer.route.stack[0].handle.name, 'lidarrArtistResponseMiddleware')
})
