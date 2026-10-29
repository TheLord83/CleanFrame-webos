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

/* Passt jede Seite auf den Schirm? Misst alle auswaehlbaren Elemente gegen die
 * Buehne (1920x1080) und verlangt Luft nach unten. Grund: "Anordnung" und
 * "Textgroesse" schrieben unten heraus, ohne dass es jemandem auffiel.
 * Gesteuert wird ueber die Aktion (focus().action), nicht ueber Tastenzaehlung -
 * sonst misst man nach einem Fehlschlag die falsche Seite. */
var MIN_AIR = 40;
var TARGETS = [
  ['settings.group.background', 'Hintergrund'],
  ['settings.group.layout', 'Anordnung'],
  ['settings.group.typography', 'Schrift'],
  ['settings.group.focus', 'Fokus'],
  ['settings.editor', 'Apps auf der Startseite'],
  ['settings.group.clocklang', 'Uhr und Sprache'],
  ['settings.group.text', 'Textgroesse'],
  ['settings.group.weather', 'Wetter'],
  ['settings.group.ent', 'Werte auf der Startseite'],
  ['settings.group.setup', 'Einrichtung'],
  ['settings.group.samsung', 'LG']
];
var total = 0, bad = [];

function ev(e, cb) { js(e, function (v) { cb(JSON.parse(v)); }); }
function press(keys, cb) { ev('JSON.stringify(CleanFrameDebug.press(' + JSON.stringify(keys) + '))', cb); }
function measure(name, cb) {
  setTimeout(function () {
    ev('JSON.stringify(CleanFrameDebug.layout())', function (l) {
      total++;
      var ok = l.fits && l.air >= MIN_AIR;
      if (!ok) bad.push(name);
      console.log((ok ? '  ok       ' : '  ZU VOLL  ') + name + '  [' + l.view + ']' +
        '  lowest=' + l.lowest + '  air=' + l.air +
        ((l.below && l.below.length) ? '  raus: ' + l.below.map(function (b) { return b.label; }).join(' | ') : ''));
      cb();
    });
  }, 550);
}
/* Von oben nach unten bis zur gewuenschten Aktion; am Zeilenende eine Spalte
 * weiter. Bricht ab, wenn sich nichts mehr bewegt. */
function goTo(action, cb, tries, seen) {
  tries = tries || 0;
  seen = seen || [];
  if (tries > 14) { console.log('        gesehen: ' + seen.join(' > ')); return cb(false); }
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.action === action) return cb(true);
    seen.push(String(f.action) + '/' + String(f.view));
    press(['down'], function (f2) {
      if (f2.action === f.action) {
        press(['right'], function (f3) {
          if (f3.action === f.action) { console.log('        stecke fest: ' + JSON.stringify(f3)); return cb(false); }
          goTo(action, cb, tries + 1, seen);
        });
      } else goTo(action, cb, tries + 1, seen);
    });
  });
}
/* Nach jeder Seite zurueck bis zur Startseite, dann in die Einstellungen -
 * sonst steuert der naechste Durchlauf auf der falschen Seite herum. */
function toStart(cb, tries) {
  tries = tries || 0;
  if (tries > 6) return cb();
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.view === 'home') return cb();
    press(['back'], function () { toStart(cb, tries + 1); });
  });
}
function toSettings(cb, tries) {
  tries = tries || 0;
  toStart(function () {
    ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
      if (f.view === 'settings') return cb();
      if (tries > 2) return cb();
      press(['down'], function () {
        press(['ok'], function () {
          ev('JSON.stringify(CleanFrameDebug.focus())', function (g) {
            if (g.view === 'settings') return cb();
            press(['back'], function () { toSettings(cb, tries + 1); });
          });
        });
      });
    });
  });
}
function openRow(i, done) {
  if (i >= TARGETS.length) return done();
  var t = TARGETS[i];
  toSettings(function () {
  press(['left', 'up', 'up', 'up', 'up', 'up', 'up', 'up', 'up'], function () {
    goTo(t[0], function (found) {
      if (!found) { total++; bad.push(t[1] + ' (nicht erreichbar)'); console.log('  FEHLT    ' + t[1] + ' (nicht erreichbar)'); return done(); }
      press(['ok'], function () {
        measure(t[1], function () {
          toStart(function () { openRow(i + 1, done); });
        });
      });
    });
  });
  });
}
http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var b = '';
  res.on('data', function (c) { b += c; });
  res.on('end', function () {
    var page = JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Page.enable', {}, function () {
        send('Page.navigate', { url: PAGE }, function () {
          setTimeout(function () {
            measure('Startseite (Leiste)', function () {
              press(['down', 'down'], function () {
                measure('Werkzeugleiste', function () {
                  press(['ok'], function () {
                    measure('Alle Apps', function () {
                      press(['back', 'down', 'ok'], function () {
                        measure('Einstellungen', function () {
                          openRow(0, function () {
                            console.log('RESULT ' + (total - bad.length) + '/' + total +
                              (bad.length ? '  zu voll: ' + bad.join(', ') : ''));
                            client.close();
                            process.exit(bad.length ? 1 : 0);
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          }, 4500);
        });
      });
    });
  });
});
