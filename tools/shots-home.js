/* Fotografiert die Startseite in drei Zustaenden, damit man den Fokus sieht.
 *
 *   node tools/shots-home.js /tmp/cf-shots
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path'), fs = require('fs');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var OUT = process.argv[2] || '/tmp/cf-shots';

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
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb || function () {}, 260); });
  });
}
function shot(name, cb) {
  send('Page.captureScreenshot', { format: 'png' }, function (msg) {
    var d = msg.result && msg.result.data;
    if (!d) { console.log('kein Bild fuer ' + name); return cb(); }
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(d, 'base64'));
    console.log(OUT + '/' + name + '.png');
    cb();
  });
}
var FOCUS = '(function(){var st=window.CleanFrameDebug.state();' +
  'var t=document.querySelector("#dock .tile.is-focus"), c=document.querySelector("#haStrip .ha-chip.is-focus"),' +
  'u=document.querySelector("#utils .u.is-focus");' +
  'return JSON.stringify({zone:st.zone,tile:t?t.textContent.trim().slice(0,14):null,' +
  'chip:c?c.textContent.trim().slice(0,14):null,util:u?u.getAttribute("aria-label"):null,' +
  'utilAwake:/is-awake/.test((document.getElementById("utils")||{}).className||"")});})()';

fs.mkdirSync(OUT, { recursive: true });
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
            /* Auf Wunsch einfarbiger Grund: sonst misst man auf dem Foto die Wolken
             * statt der Logos (weisse Marken auf hellem Himmel sind nicht trennbar). */
            if (process.env.PLAIN) {
              /* Nur die Tapete wegnehmen (die beiden Ebenen #bg und #bootWall), NICHT
               * alle Bilder: auf webOS sind die Marken selbst <img>, die hat der erste
               * Versuch mitgeloescht - dann war das Bild leer. */
              js('(function(){document.body.style.background="#101010";' +
                 'var b=document.querySelectorAll("#bg,#bootWall,.bg");' +
                 'for(var i=0;i<b.length;i++){b[i].style.display="none";}' +
                 'return 1;})()', function () {
                run();
              });
            } else run();
            function run() {
            // 1) Kachelzone, dritte Kachel (Disney)
            key('right', function () { key('right', function () {
              js(FOCUS, function (a) {
                console.log('1 kachel: ' + a);
                shot('1-apps', function () {
                  // 2) Werteleiste
                  key('up', function () {
                    js(FOCUS, function (b) {
                      console.log('2 leiste: ' + b);
                      shot('2-strip', function () {
                        // 3) Werkzeuge
                        key('down', function () {
                          js(FOCUS, function (c) {
                            console.log('3 werkzeuge: ' + c);
                            shot('3-util', function () { client.close(); process.exit(0); });
                          });
                        });
                      });
                    });
                  });
                });
              });
            }); });
            }
          }, 4500);
        });
      });
    });
  });
});
