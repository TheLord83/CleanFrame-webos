#!/usr/bin/env node
/*
 * Beliebigen JavaScript-Ausdruck in einer Chrome-Seite auswerten (CDP, ohne
 * Abhaengigkeiten). Praktisch fuer Pruefungen am laufenden Launcher.
 *
 * Aufruf: node tools/cdp-eval.js "<ausdruck>" [--port 9333] [--url <teil>]
 */
'use strict';

var http = require('http');
var net = require('net');
var crypto = require('crypto');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
var PORT = parseInt(arg('port', '9333'), 10);
var NEEDLE = arg('url', '');
var EXPR = process.argv[2];
var SHOT = arg('shot', '');

function get(url, cb) {
  http.get(url, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () { cb(null, b); });
  }).on('error', function (e) { cb(e); });
}

function wsConnect(wsUrl, onMessage, onOpen) {
  var m = /^ws:\/\/([^/:]+):(\d+)(\/.*)$/.exec(wsUrl);
  var sock = net.connect({ host: m[1], port: parseInt(m[2], 10) });
  var buf = Buffer.alloc(0), handshaken = false;
  sock.on('connect', function () {
    sock.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] +
      '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' +
      crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!handshaken) {
      var idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      handshaken = true;
      buf = buf.slice(idx + 4);
      onOpen();
    }
    while (buf.length >= 2) {
      var len = buf[1] & 127, offset = 2;
      if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
      if (buf[1] & 128) offset += 4;
      if (buf.length < offset + len) return;
      onMessage(buf.slice(offset, offset + len).toString('utf8'));
      buf = buf.slice(offset + len);
    }
  });
  sock.on('error', function () {});
  function head(len) {
    if (len < 126) return Buffer.from([0x81, 0x80 | len]);
    if (len < 65536) { var h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); return h; }
    var h2 = Buffer.alloc(10); h2[0] = 0x81; h2[1] = 0x80 | 127; h2.writeUInt32BE(0, 2); h2.writeUInt32BE(len, 6); return h2;
  }
  return {
    send: function (obj) {
      var data = Buffer.from(JSON.stringify(obj));
      var mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
      for (var i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
      sock.write(Buffer.concat([head(data.length), mask, masked]));
    },
    close: function () { sock.destroy(); }
  };
}

if (!EXPR) { console.log('Aufruf: node tools/cdp-eval.js "<ausdruck>" [--port 9333] [--url <teil>]'); process.exit(2); }

get('http://127.0.0.1:' + PORT + '/json/list', function (err, body) {
  if (err) { console.log('kein Chrome auf Port ' + PORT); process.exit(1); }
  var pages = JSON.parse(body).filter(function (t) { return t.type === 'page'; });
  var page = pages.filter(function (t) { return !NEEDLE || t.url.indexOf(NEEDLE) >= 0; })[0];
  if (!page) { console.log('kein passendes Ziel'); process.exit(1); }
  var id = 0, pending = {};
  var ws = wsConnect(page.webSocketDebuggerUrl, function (raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
  }, function () {
    var mid = ++id;
    pending[mid] = function (r) {
      var res = r.result || {};
      if (res.exceptionDetails) {
        console.log('JS-Fehler: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
      } else {
        var v = res.result && res.result.value;
        console.log(typeof v === 'string' ? v : JSON.stringify(v));
      }
      if (!SHOT) { ws.close(); process.exit(0); return; }
      /* Screenshot des aktuellen Stands (--shot /pfad.png) */
      var sid = ++id;
      pending[sid] = function (r2) {
        var data = (r2.result || {}).data || '';
        require('fs').writeFileSync(SHOT, Buffer.from(data, 'base64'));
        console.log('Screenshot: ' + SHOT);
        ws.close();
        process.exit(0);
      };
      ws.send({ id: sid, method: 'Page.captureScreenshot', params: { format: 'png' } });
    };
    ws.send({ id: mid, method: 'Runtime.evaluate', params: { expression: EXPR, returnByValue: true, awaitPromise: true } });
  });
});
