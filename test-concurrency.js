const EventEmitter = require('events')
const concurrencyLimit = require('./src/middleware/concurrency.middleware')

const res = new EventEmitter()
res.writableEnded = false
res.set = () => {}
res.status = () => res
res.json = () => {}

const req = { path: '/test' }

concurrencyLimit(req, res, () => {
  console.log('Request passed, activeRequests incremented.')
})

// Simulating a successful response
res.writableEnded = true
res.emit('finish')
res.emit('close')

console.log('Done.')
