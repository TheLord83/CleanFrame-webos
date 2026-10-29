/* Ist die Uhr im Bild? Gibt Config-Wert, DOM-Element, Rechteck und Text aus.
 *
 *   node tools/probe-clock.js
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
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
function send(me, pa, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: me, params: pa || {} }); }
function js(e, cb) { send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) { var r = msg.result && msg.result.result; cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined); }); }

var WHAT = '(function(){' +
  'var st=window.CleanFrameDebug.state();' +
  'var el=document.querySelector(".clock");' +
  'var b=el?el.getBoundingClientRect():null;' +
  'var cap=document.querySelector(".caption,.home-caption");' +
  'var cb=cap?cap.getBoundingClientRect():null;' +
  'return JSON.stringify({cfgClock:st.look?st.look.clock:"?",cfgClock24:st.look?st.look.clock24:"?",' +
  'clockEl:!!el,text:el?el.textContent.trim().slice(0,20):"",' +
  'rect:b?[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]:null,' +
  'caption:cb?[Math.round(cb.left),Math.round(cb.top),Math.round(cb.width),Math.round(cb.height)]:null,' +
  'wx:!!document.querySelector(".wx,.weather"),' +
  'stage:document.getElementById("stage").className.slice(0,60)});})()';

http.get({ host: '127.0.0.1', port: 9333, path: '/json/list' }, function (res) {
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
            js(WHAT, function (a) {
              console.log('Zustand: ' + a);
              js('(function(){window.CleanFrameDebug.look({clock:true});return 1;})()', function () {
                setTimeout(function () {
                  js(WHAT, function (b) {
                    console.log('nach clock=true: ' + b);
                    client.close();
                    process.exit(0);
                  });
                }, 900);
              });
            });
          }, 4500);
        });
      });
    });
  });
});
