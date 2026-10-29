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
var DUMP = '(function(){' +
  'var out=[];' +
  'var us=document.querySelectorAll("#utils .u");' +
  'for(var i=0;i<us.length;i++){var b=us[i];var r=b.getBoundingClientRect();' +
  'var l=b.querySelector(".u-label");var lr=l?l.getBoundingClientRect():null;' +
  'out.push({label:(l?l.textContent:""),cls:b.className,x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),' +
  'labY:lr?Math.round(lr.top):null,labW:lr?Math.round(lr.width):null,' +
  'labOp:l?getComputedStyle(l).opacity:null});}' +
  'var fl=document.getElementById("utilFocusLabel");var fr=fl?fl.getBoundingClientRect():null;' +
  'var st=window.CleanFrameDebug.state();' +
  'return JSON.stringify({zone:st.zone,index:st.index,utils:document.getElementById("utils").className,' +
  'label:{text:fl?fl.textContent:null,cls:fl?fl.className:null,x:fr?Math.round(fr.left):null,y:fr?Math.round(fr.top):null,op:fl?getComputedStyle(fl).opacity:null},' +
  'items:out});})()';

var CODES = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] };
function key(name, cb) {
  var M = CODES[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb, 300); });
  });
}

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
            js('(function(){CleanFrameDebug.look({controls:"both"});return 1;})()', function () {
              key('right', function () {
                js(DUMP, function (a0) {
                  console.log('0 start: ' + a0);
                  key('up', function () {
                    js(DUMP, function (a) {
                      console.log('1 up (Werteleiste): ' + a);
                      key('up', function () {
                        js(DUMP, function (b) {
                          console.log('2 up (Werkzeuge): ' + b);
                          shot('util-bug', function () { client.close(); process.exit(0); });
                        });
                      });
                    });
                  });
                });
              });
            });
          }, 1200);
        });
      });
    });
  });
});
