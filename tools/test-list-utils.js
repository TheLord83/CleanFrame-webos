/* Kommt man in der Listenansicht von den Zeilen zu den Werkzeugen und zurueck?
 *
 *   node tools/test-list-utils.js
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var PORT = (function () { var i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 9333; })();

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
function send(me, pa, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: me, params: pa || {} }); }
function js(e, cb) { send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) { var r = msg.result && msg.result.result; cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined); }); }
function key(name, cb) {
  var M = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] }[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb || function () {}, 280); });
  });
}
var ST = '(function(){var s=window.CleanFrameDebug.state();var u=document.querySelector("#utils .u.is-focus");' +
  'return JSON.stringify({zone:s.zone,util:u?u.getAttribute("aria-label"):null,' +
  'sel:s.sel||null,selIdx:s.selIdx,home:(s.home?Object.keys(s.home).length:null)});})()';
var fails = 0, total = 0;
function check(name, expr, cb) {
  js(ST, function (raw) {
    var st = JSON.parse(raw), ok = expr(st);
    total++;
    if (!ok) fails++;
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '   ' + raw);
    cb();
  });
}
function flow(steps, done) {
  var i = 0;
  (function next() {
    if (i >= steps.length) return done();
    var s = steps[i++];
    if (s.key) key(s.key, next); else { s.run(); next(); }
  })();
}

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Page.enable', {}, function () {
        send('Page.navigate', { url: PAGE }, function () {
          setTimeout(function () {
            js('(function(){window.CleanFrameDebug.look({layout:"list"});return 1;})()', function () {
              setTimeout(function () {
                /* Wie viele Zeilen hat die Startseite? Der Pruefstand laeuft mit einer
                 * anderen Konfiguration als der Fernseher (3 statt 6 Kacheln), also darf
                 * der Test keine feste Zahl von Tastendruecken annehmen. */
                js('(function(){var s=window.CleanFrameDebug.state();return s.home?Object.keys(s.home).length:0;})()', function (n) {
                var down = function (i) { return i > 0 ? { key: 'down' } : null; };
                var toLast = [];
                for (var i = 1; i < n; i++) toLast.push({ key: 'down' });
                flow(toLast.concat([
                  { run: function () { check('runter laeuft alle Zeilen ab', function (s) { return s.zone === 'apps'; }, function () {}); } },
                  { key: 'down' },
                  { run: function () { check('runter aus der letzten Zeile: Werkzeuge', function (s) { return s.zone === 'util'; }, function () {}); } },
                  { key: 'up' },
                  { run: function () { check('hoch aus der Saeule oben: zurueck in die Zeilen', function (s) { return s.zone === 'apps'; }, function () {}); } },
                  { key: 'down' },
                  { key: 'down' },
                  { run: function () { check('hoch aus der Saeule unten: bleibt in der Saeule', function (s) { return s.zone === 'util'; }, function () {}); } },
                  { key: 'up' },
                  { key: 'up' },
                  { run: function () { check('zweimal hoch: wieder in den Zeilen', function (s) { return s.zone === 'apps'; }, function () {}); } },
                  { key: 'right' },
                  { run: function () { check('rechts bleibt der alte Weg', function (s) { return s.zone === 'util'; }, function () {}); } },
                  { key: 'left' },
                  { run: function () { check('links zurueck in die Zeilen', function (s) { return s.zone === 'apps'; }, function () {}); } },
                  { key: 'up' },
                  { run: function () { check('hoch bleibt in den Zeilen', function (s) { return s.zone === 'apps'; }, function () {}); } }
                ]), function () {
                  js('(function(){window.CleanFrameDebug.look({layout:"dock"});return 1;})()', function () {
                    console.log('RESULT ' + (total - fails) + '/' + total);
                    client.close();
                    process.exit(fails ? 1 : 0);
                  });
                });
                });
              }, 1200);
            });
          }, 4500);
        });
      });
    });
  });
});
