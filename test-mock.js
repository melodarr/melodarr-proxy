const express = require('express');
const app = express();
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

const http = require('http');
const { EventEmitter } = require('events');

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.remoteAddress = '127.0.0.1';
    this._writableState = { corked: 0, length: 0 };
    this.writable = true;
    this.readable = true;
    this.destroyed = false;
  }
  destroy() {}
  cork() {}
  uncork() {}
  pause() {}
  resume() {}
  write(data, encoding, cb) {
    if (this.onwrite) this.onwrite(data);
    if (cb) cb();
    return true;
  }
  end() {}
  on() {}
  removeListener() {}
}

const socket = new MockSocket();
const req = new http.IncomingMessage(socket);
req.method = 'GET';
req.url = '/api/health';
req.headers = {};

const res = new http.ServerResponse(req);
res.assignSocket(socket);

let output = '';
socket.onwrite = (data) => {
  output += data.toString();
};

res.on('finish', () => {
  console.log('FINISHED');
  console.log('StatusCode:', res.statusCode);
  console.log('Headers:', res.getHeaders());
  console.log('Output:', output);
});

app(req, res);
