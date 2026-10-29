/* Misst die Listenansicht: wo stehen die Zeilen, wo die Werkzeuge, und wohin
 * fuehren die Tasten wirklich? Setzt die Ansicht auf "list" und danach zurueck.
 *
 *   node tools/probe-list.js
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path'), fs = require('fs');
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
function key(name, cb) {
  var M = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] }[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb || function () {}, 280); });
  });
}
var GEO = '(function(){' +
  'var q=function(s){var e=document.querySelector(s);if(!e)return null;var b=e.getBoundingClientRect();' +
  'return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};' +
  'var st=window.CleanFrameDebug.state();' +
  'var rows=[].map.call(document.querySelectorAll(".ph-row"),function(r){var b=r.getBoundingClientRect();' +
  'return {y:Math.round(b.top),h:Math.round(b.height),t:r.textContent.trim().slice(0,12)};});' +
  'return JSON.stringify({layout:st.look?st.look.layout:"?",zone:st.zone,' +
  'utils:q("#utils"),firstRow:rows[0]||null,lastRow:rows[rows.length-1]||null,rowCount:rows.length});})()';
function state(cb) {
  js('(function(){var s=window.CleanFrameDebug.state();var u=document.querySelector("#utils .u.is-focus");' +
     'return JSON.stringify({zone:s.zone,sel:s.sel||null,util:u?u.getAttribute("aria-label"):null});})()', cb);
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
            js('(function(){window.CleanFrameDebug.look({layout:"list"});return 1;})()', function () {
              setTimeout(function () {
                js(GEO, function (geo) {
                  console.log('Geometrie: ' + geo);
                  state(function (a) {
                    console.log('Start:     ' + a);
                    key('down', function () {
                      state(function (b) {
                        console.log('runter:    ' + b);
                        key('right', function () {
                          state(function (c) {
                            console.log('rechts:    ' + c);
                            key('down', function () {
                              state(function (d) {
                                console.log('runter(2): ' + d);
                                key('up', function () {
                                  state(function (e) {
                                    console.log('hoch:      ' + e);
                                    // zuruecksetzen
                                    js('(function(){window.CleanFrameDebug.look({layout:"dock"});return 1;})()', function () {
                                      console.log('(Ansicht zurueck auf dock)');
                                      client.close(); process.exit(0);
                                    });
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
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
