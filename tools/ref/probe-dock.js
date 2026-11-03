/* Sitzen die Marken in der Leiste mittig?
 *
 *   node tools/probe-dock.js [--port 9333]
 *
 * Misst je Kachel: Kachel, Markenfeld und die tatsaechliche Tinte (das .mk-
 * Element), dazu den Namen darunter. Ausgegeben wird der Abstand ueber und
 * unter der Tinte - bei "nur Symbole" muss er gleich sein, bei "Symbole und
 * Text" die Tinte im Raum ueber dem Namen sitzen.
 *
 * Legt zwei Bilder ab: /tmp/dock-icons.png und /tmp/dock-both.png.
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), fs = require('fs'), path = require('path');
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

var MEASURE = '(' + function () {
  var dock = document.querySelector('.dock'), tiles = [].slice.call(document.querySelectorAll('.dock .tile'));
  var out = [];
  tiles.forEach(function (tile) {
    var mark = tile.querySelector('.mark'), mk = tile.querySelector('.mk') || mark && mark.querySelector('img'),
        label = tile.querySelector('.label-ink'), tr = tile.getBoundingClientRect(),
        ir = mk ? mk.getBoundingClientRect() : null,
        lr = label ? label.getBoundingClientRect() : null;
    if (!ir) return;
    /* Das .mk-Element ist der ganze viewBox, nicht die Tinte. Fuer die Optik zaehlt
     * die Tinte: sie beginnt (m.y-m.vy)*k unter der Oberkante und ist m.h*k hoch. */
    var met = window.FrameIconMetrics && window.FrameIconMetrics[mk.parentNode.getAttribute('data-mark')];
    if (met && ir.width) {
      var k = ir.width / met.vw;
      ir = { top: ir.top + (met.y - met.vy) * k, bottom: ir.top + (met.y - met.vy) * k + met.h * k,
             width: met.w * k, height: met.h * k };
    }
    out.push({
      name: tile.getAttribute('aria-label') || (label ? label.textContent : ''),
      tile: [Math.round(tr.top), Math.round(tr.bottom), Math.round(tr.width)],
      ink: [Math.round(ir.top), Math.round(ir.bottom), Math.round(ir.width), Math.round(ir.height)],
      above: Math.round(ir.top - tr.top),
      below: label ? Math.round(lr.top - ir.bottom) : Math.round(tr.bottom - ir.bottom),
      labelTop: lr ? Math.round(lr.top - tr.top) : null
    });
  });
  return JSON.stringify({ dock: dock ? [Math.round(dock.getBoundingClientRect().top), Math.round(dock.getBoundingClientRect().height)] : null, tiles: out });
}.toString() + ')()';

function look(apps, cb) {
  js('JSON.stringify(CleanFrameDebug.look(' + JSON.stringify({ apps: apps }) + '))', function () { setTimeout(cb, 900); });
}

var results = [];
/* Eine Marke gilt als mittig, wenn ueber und unter ihr gleich viel Platz ist
 * (+-8 px, weil die Tinte selbst nicht immer symmetrisch im viewBox liegt). */
function check(apps, d) {
  d.tiles.forEach(function (t) {
    if (apps === 'icons') {
      var delta = Math.abs(t.above - t.below);
      results.push({ name: apps + ' ' + t.name, ok: delta <= 8, info: 'ueber ' + t.above + ' / unten ' + t.below });
    } else {
      var ok = t.above >= 8 && t.below >= 8;
      results.push({ name: apps + ' ' + t.name, ok: ok, info: 'ueber ' + t.above + ' / Luft zum Namen ' + t.below });
    }
  });
  var c = d.tiles.map(function (t) { return t.above + t.ink[3] / 2; });
  var spread = Math.round(Math.max.apply(null, c) - Math.min.apply(null, c));
  results.push({ name: apps + ' Marken-Mitte buendig', ok: spread <= 8, info: spread + ' px Unterschied' });
}

function measure(apps, cb) {
  js(MEASURE, function (v) {
    var d = JSON.parse(v);
    console.log('--- ' + apps + ' (Leiste y ' + d.dock[0] + ', hoch ' + d.dock[1] + ')');
    d.tiles.forEach(function (t) {
      console.log('  ' + (t.name || '?').slice(0, 14).padEnd(15) + ' ueber ' + String(t.above).padStart(3) +
        '  unten ' + String(t.below).padStart(3) + '  Tinte ' + t.ink[2] + 'x' + t.ink[3] +
        (t.labelTop !== null ? '  Name ab ' + t.labelTop : ''));
    });
    check(apps, d);
    cb(d);
  });
}

function report() {
  var bad = results.filter(function (r) { return !r.ok; });
  bad.forEach(function (r) { console.log('  FEHLER ' + r.name + ': ' + r.info); });
  console.log('RESULT ' + (results.length - bad.length) + '/' + results.length);
  return bad.length ? 1 : 0;
}

var CLIP = null;
function shot(name, cb) {
  var params = { format: 'png' };
  if (CLIP) params.clip = CLIP;
  send('Page.captureScreenshot', params, function (r) {
    if (!r.result || !r.result.data) { console.log('kein Bild fuer ' + name); return cb(); }
    fs.writeFileSync('/tmp/' + name + '.png', Buffer.from(r.result.data, 'base64'));
    console.log('shot /tmp/' + name + '.png');
    cb();
  });
}

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var b = '';
  res.on('data', function (c) { b += c; });
  res.on('end', function () {
    var page = JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw); if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, function () {
        send('Page.enable', {}, function () {
          send('Page.navigate', { url: PAGE }, function () {
            setTimeout(function () {
              js('JSON.stringify(CleanFrameDebug.look({}))', function (v) {
                var pos = JSON.parse(v);
                console.log('Ausgangslage: ' + JSON.stringify(pos));
                js('JSON.stringify((function(){var d=document.querySelector(".dock").getBoundingClientRect();return {x:Math.round(d.left)-24,y:Math.round(d.top)-24,width:Math.round(d.width)+48,height:Math.round(d.height)+48};})())', function (c) {
                  CLIP = Object.assign(JSON.parse(c), { scale: 1 });
                  measure('ausgangslage', function () {
                    shot('dock-start', function () {
                      look('icons', function () {
                        measure('icons', function () {
                          shot('dock-icons-belegt', function () {
                            look('both', function () {
                              measure('both', function () {
                                shot('dock-both', function () { client.close(); process.exit(report()); });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            }, 5000);
          });
        });
      });
    });
  });
});
