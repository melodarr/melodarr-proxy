const http = require('node:http')
const { EventEmitter } = require('node:events')

class MockSocket extends EventEmitter {
  constructor () {
    super()
    this.remoteAddress = '127.0.0.1'
    this._writableState = { corked: 0, length: 0 }
    this.writable = true
    this.readable = true
    this.destroyed = false
  }

  destroy () {}
  cork () {}
  uncork () {}
  pause () {}
  resume () {}
  write (data, encoding, cb) {
    if (this.onwrite) this.onwrite(data)
    if (cb) cb()
    return true
  }

  end () {}
  on () {}
  removeListener () {}
}

function request (app) {
  return {
    get (path) {
      this.method = 'GET'
      this.path = path
      this.headers = {}
      this.expects = []
      return this
    },
    set (key, value) {
      this.headers[key.toLowerCase()] = value
      return this
    },
    expect (a, b) {
      this.expects.push([a, b])
      return this
    },
    then (resolve, reject) {
      const socket = new MockSocket()
      const req = new http.IncomingMessage(socket)
      req.method = this.method
      req.url = this.path
      req.headers = this.headers

      const res = new http.ServerResponse(req)
      res.assignSocket(socket)

      let output = ''
      socket.onwrite = (data) => {
        output += data.toString()
      }

      res.on('finish', () => {
        const parts = output.split('\r\n\r\n')
        const bodyText = parts.length > 1 ? parts.slice(1).join('\r\n\r\n') : ''

        const response = {
          status: res.statusCode,
          headers: res.getHeaders(),
          text: bodyText,
          body: null
        }

        const contentType = res.getHeader('content-type')
        if (contentType && contentType.includes('json')) {
          try { response.body = JSON.parse(bodyText) } catch (e) {}
        }

        try {
          for (const [a, b] of this.expects) {
            if (typeof a === 'number') {
              if (response.status !== a) throw new Error(`Expected status ${a}, got ${response.status}`)
            } else if (typeof a === 'string' && b instanceof RegExp) {
              const headerVal = response.headers[a.toLowerCase()] || ''
              if (!b.test(headerVal)) throw new Error(`Expected header ${a} to match ${b}, got ${headerVal}`)
            }
          }
          resolve(response)
        } catch (e) {
          reject(e)
        }
      })

      // Try running the app
      try {
        app(req, res)
      } catch (e) {
        reject(e)
      }
    }
  }
}

module.exports = request
