const { buildUpdateStatus } = require('./src/controllers/update.controller')
buildUpdateStatus().then(console.log).catch(console.error)
