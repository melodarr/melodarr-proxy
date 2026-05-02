const { handleArtistLookup } = require('./src/controllers/proxy.controller.js')

const req = {
  query: { term: process.argv[2] || 'Radiohead' }
}

const res = {
  status: function (code) {
    this.statusCode = code
    return this
  },
  set: function (header, value) {
    // console.log(`Set header ${header}: ${value}`)
  },
  json: function (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

handleArtistLookup(req, res).catch(console.error).finally(() => process.exit(0))
