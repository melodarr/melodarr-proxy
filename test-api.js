const http = require('http')
http.get('http://127.0.0.1:3055/api/health', (res) => {
  let data = ''
  res.on('data', chunk => {
    data += chunk
  })
  res.on('end', () => console.log('health:', data))
}).on('error', err => console.log('health error:', err.message))

http.get('http://127.0.0.1:3055/debug/metrics', (res) => {
  let data = ''
  res.on('data', chunk => {
    data += chunk
  })
  res.on('end', () => console.log('metrics:', data))
}).on('error', err => console.log('metrics error:', err.message))
