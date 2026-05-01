const express = require('express');
const app = express();
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', nested: { val: 1 } }));

const http = require('http');
const { EventEmitter } = require('events');

class MockSocket extends EventEmitter {
  constructor() { super(); this.remoteAddress = '127.0.0.1'; this._writableState = { corked: 0, length: 0 }; this.writable = true; this.readable = true; this.destroyed = false; }
  destroy() {} cork() {} uncork() {} pause() {} resume() {} write(data, encoding, cb) { if(cb)cb(); return true; } end() {} on() {} removeListener() {}
}

function makeRequest(app, method, url, headers = {}) {
  return new Promise((resolve) => {
    const socket = new MockSocket();
    const req = new http.IncomingMessage(socket);
    req.method = method; req.url = url; req.headers = headers;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    const chunks = [];
    const originalWrite = res.write;
    const originalEnd = res.end;

    res.write = function(chunk, encoding, cb) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      return originalWrite.call(this, chunk, encoding, cb);
    };

    res.end = function(chunk, encoding, cb) {
      if (typeof chunk === 'function') { cb = chunk; chunk = null; encoding = null; }
      else if (typeof encoding === 'function') { cb = encoding; encoding = null; }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      
      originalEnd.call(this, chunk, encoding, cb);
      
      const bodyBuffer = Buffer.concat(chunks);
      let data = bodyBuffer.toString('utf8');
      
      const resHeaders = Object.assign({}, res.getHeaders());
      if (resHeaders['content-type'] && resHeaders['content-type'].includes('application/json')) {
        try { data = JSON.parse(data); } catch (e) {}
      }
      resolve({ status: res.statusCode, headers: resHeaders, data: data });
    };

    app(req, res);
  });
}

makeRequest(app, 'GET', '/api/health').then(console.log);
