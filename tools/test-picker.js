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

/* Prueft die aufklappbaren Zeilen (TV-Variante des Dropdowns): Zeile zeigt den
 * Wert, OK klappt die Antworten als Karte darueber auf, hoch/runter geht weiter,
 * und die aufgeklappte Karte darf nicht aus dem Bild oder ueber Nachbarzeilen.
 *
 *   node tools/test-picker.js --port 9333
 */
var MIN_AIR = 30, results = [];

function ev(e, cb) { js(e, function (v) { cb(JSON.parse(v)); }); }
function press(keys, cb) { ev('JSON.stringify(CleanFrameDebug.press(' + JSON.stringify(keys) + '))', cb); }
function check(ok, name, note) {
  results.push({ ok: ok, name: name });
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
}
function rows(cb) {
  ev('(function(){var out=[];var s=document.querySelectorAll(".setting-section");' +
     'for(var i=0;i<s.length;i++){var b=s[i].querySelector(".pick-row"),l=s[i].querySelector(".setting-label");' +
     'if(!b&&!l)continue;out.push({q:l?l.textContent.trim():"",v:b?b.querySelector(".setting-name").textContent.trim():null,' +
     'open:!!s[i].className.match(/is-open/),covered:!!s[i].className.match(/is-covered/),' +
     'opts:s[i].querySelectorAll(".picker-list .setting-choice").length});}' +
     'var card=document.querySelector(".picker-list");' +
     'return JSON.stringify({sections:out,cardW:card?Math.round(parseFloat(getComputedStyle(card).width)):0});})()', cb);
}
function goTo(action, cb, tries) {
  tries = tries || 0;
  if (tries > 16) return cb(false);
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.action === action) return cb(true);
    press(['down'], function (f2) {
      if (f2.action === f.action) press(['right'], function (f3) { goTo(action, cb, tries + 1); });
      else goTo(action, cb, tries + 1);
    });
  });
}
function toSettings(cb, tries) {
  tries = tries || 0;
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.view === 'settings') return cb();
    if (f.view !== 'home') return press(['back'], function () { toSettings(cb, tries + 1); });
    press(['down'], function () { press(['ok'], function () { toSettings(cb, function () { cb(); }, tries + 1); }); });
  });
}
function openWeather(cb) {
  toSettings(function () {
    goTo('settings.group.weather', function (ok) {
      if (!ok) return cb(false);
      press(['ok'], function () { setTimeout(function () { cb(true); }, 700); });
    });
  });
}
function layout(cb) { ev('JSON.stringify(CleanFrameDebug.layout())', cb); }

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () {
    var page = JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw); if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Page.enable', {}, function () { send('Page.navigate', { url: PAGE }, function () {
        setTimeout(function () {
          openWeather(function (ok) {
            if (!ok) { console.log('  FEHL  Wetterseite nicht erreichbar'); return finish(); }
            rows(function (rr) { var r = rr.sections;
              check(r.length === 4 && r.every(function (x) { return x.v; }), 'vier Zeilen mit Wert', JSON.stringify(r.map(function (x) { return x.q + '=' + x.v; })));
              check(r.every(function (x) { return !x.open; }), 'alle zugeklappt');
              var first = r[0].v;
              press(['ok'], function () {
                setTimeout(function () {
                  rows(function (rr2) { var r2 = rr2.sections;
                    check(r2[0].open, 'OK klappt die Zeile auf');
                    check(r2[0].opts === 4, 'vier Antworten im Panel', 'opts=' + r2[0].opts);
                    /* Stefan: "das dropdown ragt ins vorschaubild rein und ist bissl breit".
                     * Die x-Achse des Pruefstands ist verschoben, die Breite nicht. */
                    check(rr2.cardW > 0 && rr2.cardW <= 600, 'Karte ist schmal (max 600 px)', 'Breite=' + rr2.cardW + ' px');
                    check(r2[1] && r2[1].covered, 'Zeile unter der Karte ist verdeckt (keine Ueberlappung)', r2.map(function (x) { return x.q + (x.covered ? '=zu' : '=offen'); }).join(' '));
                    layout(function (l) {
                      check(l.fits && l.air >= MIN_AIR, 'aufgeklappt passt es', 'lowest=' + l.lowest + ' air=' + l.air);
                      check(!(l.overlaps || []).length, 'aufgeklappt keine Ueberlappung', JSON.stringify((l.overlaps || []).slice(0, 2)));
                      /* Rechts beginnt bei x 872 die Flaeche, in der die Startseite
                       * durchscheint. Stefan: "das dropdown ragt ins vorschaubild rein". */

                      ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
                        check(f.action.indexOf('wx.wxStyle') === 0, 'Fokus steht in den Antworten', f.action);
                        press(['down'], function () {
                          setTimeout(function () {
                            rows(function (rr3) { var r3 = rr3.sections;
                              check(!r3[0].open && !r3[1].covered, 'runter klappt zu');
                              ev('JSON.stringify(CleanFrameDebug.focus())', function (g) {
                                check(g.action === 'pick.wxSize', 'runter landet auf der naechsten Frage', g.action);
                                press(['ok'], function () {
                                  setTimeout(function () {
                                    press(['right'], function () {
                                      ev('JSON.stringify(CleanFrameDebug.focus())', function (h) {
                                        var picked = h.label;
                                        press(['ok'], function () {
                                          setTimeout(function () {
                                            rows(function (rr4) { var r4 = rr4.sections;
                                              check(!r4[1].open, 'OK uebernimmt und klappt zu');
                                              check(r4[1].v === picked, 'neuer Wert steht in der Zeile', r4[1].v + ' (erwartet ' + picked + ')');
                                              check(r4[0].v === first, 'erste Zeile unveraendert', r4[0].v);
                                              /* Stefan: die Zeile "Where it sits" zeigte denselben Text
                                               * wie der Wert darunter ("Right edge" als Frage und als
                                               * Antwort, bei einer anderen Wahl "Normal" doppelt).
                                               * Jede Zeile braucht ihren eigenen Text. */
                                              ev('(function(){var out=[];var s=document.querySelectorAll(".setting-section .pick-row .setting-name");' +
                                                 'for(var i=0;i<s.length;i++)out.push(s[i].textContent.trim());return JSON.stringify(out);})()',
                                                function (vals) {
                                                var seen = {}, dup = null;
                                                vals.forEach(function (v) { if (seen[v]) dup = v; seen[v] = 1; });
                                                var qs = r4.map(function (x) { return x.q; });
                                                var qDup = null, qSeen = {};
                                                qs.forEach(function (q) { if (qSeen[q]) qDup = q; qSeen[q] = 1; });
                                                check(qs.length === 4 && !qDup, 'vier Fragen, jede nur einmal', JSON.stringify(qs) + (qDup ? ' doppelt: ' + qDup : ''));
                                                check(vals.length === 4 && !dup, 'vier Zeilen, jede mit eigenem Wert',
                                                  JSON.stringify(vals) + (dup ? ' doppelt: ' + dup : ''));
                                                back(function () { finish(); });
                                              });
                                            });
                                          }, 900);
                                        });
                                      });
                                    });
                                  }, 700);
                                });
                              });
                            });
                          }, 800);
                        });
                      });
                    });
                  });
                }, 800);
              });
            });
          });
        }, 4200);
      }); });
    });
  });
});
function back(cb) { press(['back'], function () { press(['back'], function () { setTimeout(cb, 400); }); }); }
function finish() {
  var bad = results.filter(function (r) { return !r.ok; });
  console.log('\nRESULT ' + (results.length - bad.length) + '/' + results.length);
  client.close(); process.exit(bad.length ? 1 : 0);
}
