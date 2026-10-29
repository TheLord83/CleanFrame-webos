/* Diagnose: was denkt der Launcher, waehrend in der Leiste navigiert wird? Gibt
 * Chip-Anzahl, f.h, Fokusindex im DOM und die Klassen aus.
 *
 *   node tools/probe-ha.js --port 9333
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PORT = 9333, PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');

function wsConnect(url, onMessage, onOpen) {
  var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(url);
  var sock = net.connect({ host: m[1], port: parseInt(m[2], 10) });
  var key = crypto.randomBytes(16).toString('base64'), tail = Buffer.alloc(0), up = false, api;
  sock.on('connect', function () {
    sock.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] +
      '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    tail = Buffer.concat([tail, chunk]);
    if (!up) { var e = tail.indexOf('\r\n\r\n'); if (e < 0) return; up = true; tail = tail.slice(e + 4); if (onOpen) onOpen(api); }
    for (;;) {
      if (tail.length < 2) return;
      var op = tail[0] & 0x0f, len = tail[1] & 0x7f, off = 2;
      if (len === 126) { if (tail.length < 4) return; len = tail.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (tail.length < 10) return; len = Number(tail.readBigUInt64BE(2)); off = 10; }
      if (tail.length < off + len) return;
      var p = tail.slice(off, off + len); tail = tail.slice(off + len);
      if (op === 1) onMessage(p.toString('utf8'));
      else if (op === 8) { sock.end(); return; }
    }
  });
  api = { send: function (o) {
      var b = Buffer.from(JSON.stringify(o), 'utf8'), h;
      if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(b.length, 2); }
      var mk = crypto.randomBytes(4), out = Buffer.alloc(b.length);
      for (var i = 0; i < b.length; i++) out[i] = b[i] ^ mk[i % 4];
      sock.write(Buffer.concat([h, mk, out]));
    }, close: function () { try { sock.end(); } catch (x) {} } };
  return api;
}
var client, id = 0, waiting = {};
function send(method, params, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: method, params: params || {} }); }
function js(expr, cb) { send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (msg) { var r = msg.result && msg.result.result; cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined); }); }
var KEYS = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] };
function key(name, cb) {
  var k = KEYS[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k[0], code: k[0], windowsVirtualKeyCode: k[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: k[0], code: k[0], windowsVirtualKeyCode: k[1] }, function () { setTimeout(cb || function () {}, 300); });
  });
}
var STATE = '(function(){var st=window.CleanFrameDebug.state();var chips=[].slice.call(document.querySelectorAll("#haStrip .ha-chip"));' +
  'return JSON.stringify({zone:st.zone,chips:chips.length,focusCls:chips.filter(function(c){return c.className.indexOf("is-focus")>=0;}).map(function(c){return c.textContent;}),' +
  'texts:chips.map(function(c){return c.textContent+" ["+c.className+"]";})});})()';

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var body = ''; res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw); if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, function () {
        send('Network.enable', {}, function () { send('Network.setCacheDisabled', { cacheDisabled: true }, function () { send('Page.enable', {}, function () { send('Page.navigate', { url: PAGE }, function () { setTimeout(start, 5000); }); }); }); });
      });
    });
  });
});

function show(label, cb) {
  js(STATE, function (raw, i) {
    var o = JSON.parse(raw);
    console.log(label + '  zone=' + o.zone + ' chips=' + o.chips + ' focus=' + JSON.stringify(o.focusCls));
    if (cb) cb();
  });
}
function start() {
  js('(function(){try{window.CleanFrameDebug.focusStage();}catch(e){}return 1;})()', function () {
    show('start', function () {
      key('up', function () {
        show('up   ', function () {
          key('left', function () {
            show('left ', function () {
              key('left', function () {
                show('left2', function () {
                  key('right', function () { show('right', function () { client.close(); process.exit(0); }); });
                });
              });
            });
          });
        });
      });
    });
  });
}
