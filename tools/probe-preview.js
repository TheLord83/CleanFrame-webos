/* Ueberlappt die Einstellungsspalte das Vorschaufenster?
 *
 *   node tools/probe-preview.js [--port 9333]
 *
 * Oeffnet jede Detailseite der Einstellungen, misst die Spalte (`.appearance-rows`)
 * und die linke Kante der Vorschau und meldet, um wie viel die Spalte hineinragt.
 * Ein Bild der Hintergrund-Seite landet als /tmp/preview-background.png.
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
  function box(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  }
  var col = box('.appearance-rows');
  /* Die Vorschau auf den Detailseiten ist die .scene (Bild, Uhr und Kacheln im
   * Rahmen) - .preview/.phone gibt es dort nicht. */
  var prev = box('.scene') || box('.preview') || box('.appearance-preview') || box('.phone') || box('.preview-frame');
  return JSON.stringify({ col: col, prev: prev });
}.toString() + ')()';

var GROUPS = ['background', 'layout', 'typography', 'focus', 'clocklang', 'text', 'weather', 'rotation'];
var out = [];

function step(i) {
  if (i >= GROUPS.length) return done();
  var g = GROUPS[i];
  js('JSON.stringify((function(){CleanFrameDebug.openSettings("' + g + '");return true;})())', function () {
    setTimeout(function () {
      js(MEASURE, function (v) {
        var d = JSON.parse(v);
        var over = d.col && d.prev ? d.col.right - d.prev.left : null;
        out.push({ group: g, col: d.col, prev: d.prev && d.prev.left, over: over });
        console.log('  ' + g.padEnd(12) + ' Spalte ' + (d.col ? d.col.left + '..' + d.col.right + ' (' + d.col.width + ')' : '-') +
          '   Vorschau ab ' + (d.prev ? d.prev.left : '-') +
          '   Ueberlappung ' + (over === null ? '-' : (over > 0 ? over + ' px' : 'keine')));
        if (g === 'background') {
          send('Page.captureScreenshot', { format: 'png' }, function (r) {
            if (r.result && r.result.data) {
              fs.writeFileSync('/tmp/preview-background.png', Buffer.from(r.result.data, 'base64'));
              console.log('  Bild /tmp/preview-background.png');
            }
            step(i + 1);
          });
        } else step(i + 1);
      });
    }, 1100);
  });
}

function done() {
  var bad = out.filter(function (r) { return r.over !== null && r.over > 0; });
  bad.forEach(function (r) { console.log('  UEBERLAPPUNG ' + r.group + ': ' + r.over + ' px in die Vorschau'); });
  console.log('RESULT ' + (out.length - bad.length) + '/' + out.length);
  client.close();
  process.exit(bad.length ? 1 : 0);
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
            setTimeout(function () { step(0); }, 5000);
          });
        });
      });
    });
  });
});
