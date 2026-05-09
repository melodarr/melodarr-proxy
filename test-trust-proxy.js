const express = require('express')
const app = express()
app.set('trust proxy', true)

app.get('/', (req, res) => {
  res.json({ ip: req.ip, xForwardedFor: req.headers['x-forwarded-for'] })
})

const server = app.listen(3001, '127.0.0.1', () => {
  console.log('Listening on 3001')

  fetch('http://127.0.0.1:3001/', {
    headers: { 'x-forwarded-for': '192.168.1.5, 10.0.0.1' }
  })
    .then(res => res.json())
    .then(data => {
      console.log('Response:', data)
      server.close()
    })
})
