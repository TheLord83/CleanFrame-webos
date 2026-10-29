/* Sitzen die Logos optisch richtig? Gemessen wird die Unterkante jeder Grafik gegen
 * die Namenszeile - nicht die Feldmitte, denn die sieht man nicht.
 *
 *   node tools/test-mark-alignment.js --port 9333
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');

function arg(name, fallback) { var i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; }
var PORT = parseInt(arg('port', '9333'), 10);
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');

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

var results = [];
function check(name, ok, detail) { results.push({ name: name, ok: !!ok }); console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok || !detail ? '' : '  ->  ' + detail)); }
function finish() {
  var ok = results.filter(function (r) { return r.ok; }).length;
  console.log('RESULT ' + ok + '/' + results.length);
  client.close(); process.exit(ok === results.length ? 0 : 1);
}

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var body = ''; res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    if (!page) { console.log('no page on port ' + PORT); process.exit(1); }
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw); if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, function () {
        send('Network.enable', {}, function () { send('Network.setCacheDisabled', { cacheDisabled: true }, function () {        send('Network.enable', {}, function () {
          send('Network.setCacheDisabled', { cacheDisabled: true }, function () {
            send('Page.enable', {}, function () {
              send('Page.navigate', { url: PAGE }, function () { setTimeout(start, 5000); });
            });
          });
        }); }); });
      });
    });
  });
});

/* Fuer jede Kachel: Unterkante der gezeichneten Grafik (das .mk-Element traegt die
 * tatsaechliche Groesse) und Oberkante des Namens. Beides gegen die Kachel-Oberkante. */
var MEASURE = [
  '(function(){',
  'var out=[];',
  '[].slice.call(document.querySelectorAll("#dock .tile")).forEach(function(t){',
  '  var mk=t.querySelector(".mk"), label=t.querySelector(".label"), field=t.querySelector(".mark");',
  '  if(!mk||!label) return;',
  '  var tr=t.getBoundingClientRect(), mr=mk.getBoundingClientRect(), lr=label.getBoundingClientRect(), fr=field?field.getBoundingClientRect():null;',
  '  out.push({name:(t.querySelector(".label")||{}).textContent,',
  '    fieldTop: fr?Math.round(fr.top-tr.top):null, fieldBottom: fr?Math.round(fr.bottom-tr.top):null,',
  '    inkTop: Math.round(mr.top-tr.top), inkBottom: Math.round(mr.bottom-tr.top),',
  '    labelTop: Math.round(lr.top-tr.top), gap: Math.round(lr.top-mr.bottom)});',
  '});',
  'return JSON.stringify(out);})()'
].join('');

function start() {
  js(MEASURE, function (raw) {
    var rows;
    try { rows = JSON.parse(raw); } catch (e) { console.log('parse: ' + raw); return finish(); }
    if (!rows.length) { console.log('keine Kacheln gemessen'); return finish(); }
    var gaps = [];
    rows.forEach(function (r) {
      console.log('  ' + String(r.name).padEnd(14) + ' Feld ' + r.fieldTop + '..' + r.fieldBottom +
        '  Grafik ' + r.inkTop + '..' + r.inkBottom + '  Name ab ' + r.labelTop + '  Abstand ' + r.gap);
      gaps.push(r.gap);
    });
    var min = Math.min.apply(null, gaps), max = Math.max.apply(null, gaps);
    check('every logo keeps a gap to its name', min >= 0, 'kleinster Abstand ' + min);
    check('the gaps are within 3 px of each other', (max - min) <= 3, min + '..' + max);
    check('no logo leaves its field at the top', rows.every(function (r) { return r.inkTop >= 0; }),
          rows.filter(function (r) { return r.inkTop < 0; }).map(function (r) { return r.name + ' ' + r.inkTop; }).join(', '));
    finish();
  });
}
