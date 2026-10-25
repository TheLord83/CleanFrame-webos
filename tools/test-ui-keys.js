#!/usr/bin/env node
/*
 * Treibt die Launcher-Oberflaeche ohne Fernseher und ohne Screenshot.
 *
 * Laedt index.html in einem kopflosen Chrome (Debug-Port per --port), ersetzt die
 * Geraeteanbindung durch eine Attrappe, setzt den Fokus auf die Buehne und schickt
 * echte Tastendruecke ueber Input.dispatchKeyEvent — denselben Weg wie die
 * Fernbedienung.
 *
 * Der Fokus ist der entscheidende Punkt: die App hoert auf document, aber nur
 * wenn der Fokus nicht in einem Eingabefeld steht. Ohne window.focus() bleibt
 * das headless-Fenster unfokussiert und der keydown erreicht die Buehne nicht —
 * genau das war die Ursache fuer "Pfeil runter tut im Kontextmenue nichts".
 *
 * Start des Browsers (einmal):
 *   chrome --headless=new --no-sandbox --remote-debugging-port=9333 \
 *          --allow-file-access-from-files about:blank
 *
 * Aufruf: node tools/test-ui-keys.js [--port 9333] [--debug]
 */
'use strict';

var http = require('http');
var net = require('net');
var crypto = require('crypto');
var path = require('path');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

var PORT = parseInt(arg('port', '9333'), 10);
var DEBUG = process.argv.indexOf('--debug') > 0;
var APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
/* Mit --config <url> wird eine echte Konfiguration geladen (z. B. ein lokal
 * laufender Server). Ohne die Option laeuft die Pruefung mit Attrappe und ohne
 * Konfiguration; dann sind Meldungen englisch (Schluessel = Text). */
var CONFIG_URL = arg('config', '');
var STUB_SERVER = CONFIG_URL ? CONFIG_URL.replace(/\/api\/config$/, '') : '';

function get(url, cb) {
  http.get(url, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () { cb(null, b); });
  }).on('error', function (e) { cb(e); });
}

/* Minimaler WebSocket-Client (nur Textframes) ohne Abhaengigkeiten. */
function wsConnect(wsUrl, onMessage, onOpen) {
  var m = /^ws:\/\/([^/:]+):(\d+)(\/.*)$/.exec(wsUrl);
  var sock = net.connect({ host: m[1], port: parseInt(m[2], 10) });
  var key = crypto.randomBytes(16).toString('base64');
  var buf = Buffer.alloc(0), handshaken = false;
  sock.on('connect', function () {
    sock.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] +
      '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!handshaken) {
      var idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      handshaken = true;
      buf = buf.slice(idx + 4);
      onOpen();
    }
    while (buf.length >= 2) {
      var len = buf[1] & 127, offset = 2;
      if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
      if (buf[1] & 128) offset += 4;
      if (buf.length < offset + len) return;
      var payload = buf.slice(offset, offset + len);
      buf = buf.slice(offset + len);
      onMessage(payload.toString('utf8'));
    }
  });
  sock.on('error', function () {});
  function frameHead(len) {
    if (len < 126) return Buffer.from([0x81, 0x80 | len]);
    if (len < 65536) { var h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); return h; }
    var h2 = Buffer.alloc(10); h2[0] = 0x81; h2[1] = 0x80 | 127; h2.writeUInt32BE(0, 2); h2.writeUInt32BE(len, 6); return h2;
  }
  return {
    send: function (obj) {
      var data = Buffer.from(JSON.stringify(obj));
      var mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length);
      for (var i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
      sock.write(Buffer.concat([frameHead(data.length), mask, masked]));
    },
    close: function () { sock.destroy(); }
  };
}

function main() {
  get('http://127.0.0.1:' + PORT + '/json/list', function (err, body) {
    if (err) { console.log('FAIL: kein Chrome auf Port ' + PORT); process.exit(1); }
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    if (!page) { console.log('FAIL: kein Page-Target'); process.exit(1); }
    run(page.webSocketDebuggerUrl);
  });
}

function run(wsUrl) {
  var id = 0, pending = {}, results = [], ws;

  function send(method, params, cb) {
    var mid = ++id;
    pending[mid] = cb || function () {};
    ws.send({ id: mid, method: method, params: params });
  }
  function evalJs(expr, cb) {
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (r) {
      var v = r.result && r.result.result;
      if (r.result && r.result.exceptionDetails && DEBUG) {
        console.log('    js-fehler: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
      }
      cb(v ? v.value : undefined);
    });
  }
  function check(name, ok, detail) {
    results.push({ name: name, ok: !!ok });
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail !== undefined ? '  [' + detail + ']' : ''));
  }
  function dbg(label) {
    if (!DEBUG) return;
    evalJs('JSON.stringify({keys: (window.__kd || []), focus: Array.prototype.findIndex.call(document.querySelectorAll("#sheetView .settings-group"), function (e) { return e.className.indexOf("is-focus") >= 0; }), active: (document.activeElement || {}).tagName, view: (window.CleanFrameDebug ? window.CleanFrameDebug.state().view : "-")})', function (v) {
      console.log('    debug ' + label + ': ' + v);
    });
  }

  var KEYS = {
    up: [38, 'ArrowUp'], down: [40, 'ArrowDown'], left: [37, 'ArrowLeft'],
    right: [39, 'ArrowRight'], ok: [13, 'Enter'], back: [461, 'Backspace']
  };
  function key(name, cb) {
    var k = KEYS[name];
    send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: k[1], code: k[1], windowsVirtualKeyCode: k[0],
      nativeVirtualKeyCode: k[0], text: name === 'ok' ? '\r' : undefined
    }, function () {
      send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: k[1], code: k[1], windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0]
      }, function () { setTimeout(cb, 300); });
    });
  }
  /* Der Fokus liegt entweder auf einem Listeneintrag oder auf einem Knopf im
   * Sheet; beides wird getrennt gezaehlt, damit die Pruefung nicht von der
   * DOM-Reihenfolge abhaengt. */
  function focusInfo(cb) {
    evalJs('JSON.stringify({sheetFocus: Array.prototype.findIndex.call(document.querySelectorAll("#sheetView .is-focus"), function (e) { return e.getAttribute("data-z") === "ctx"; }), item: Array.prototype.findIndex.call(document.querySelectorAll("#sheetView .settings-group"), function (e) { return e.className.indexOf("is-focus") >= 0; }), buttons: Array.prototype.map.call(document.querySelectorAll("#sheetView .settings-group"), function (e) { return e.querySelector(".settings-group-name").textContent + (e.className.indexOf("is-focus") >= 0 ? " *" : ""); })})', function (raw) {
      var o = {};
      try { o = JSON.parse(raw); } catch (e) {}
      cb(o.item >= 0 ? o.item : o.sheetFocus, o.buttons || []);
    });
  }
  function focusIndex(cb) { focusInfo(function (i) { cb(i); }); }
  function finish() {
    var failed = results.filter(function (r) { return !r.ok; });
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' Tastenpruefungen bestanden');
    try { ws.close(); } catch (e) {}
    process.exit(failed.length ? 1 : 0);
  }

  var LOADCFG = CONFIG_URL
    ? 'loadConfig: function (cb) { var x = new XMLHttpRequest(); x.open("GET", ' + JSON.stringify(CONFIG_URL) + ', true); x.onreadystatechange = function () { if (x.readyState !== 4) return; var d = null; try { d = JSON.parse(x.responseText); } catch (e) {} cb(null, d && d.config || null); }; x.send(); },'
    : 'loadConfig: function (cb) { cb(null, null); },';
  var STUB = 'window.FrameDevice = {' +
    'launchApp: function (id, cb) { window.__launched = id; if (cb) cb(null); },' +
    'launch: function (b, cb) { if (cb) cb(null); },' +
    'apps: function (cb) { cb(null, []); },' +
    'home: function (cb) { if (cb) cb(null); },' +
    'settings: function (cb) { if (cb) cb(null); },' +
    'art: function (cb) { window.__screensaver = true; if (cb) cb(null); },' +
    LOADCFG +
    (STUB_SERVER
      ? 'saveConfig: function (c, cb) { window.__saved = c; var x = new XMLHttpRequest(); x.open("PUT", ' + JSON.stringify(STUB_SERVER + '/api/config') + ', true); x.setRequestHeader("Content-Type", "application/json"); x.onreadystatechange = function () { if (x.readyState === 4) { if (cb) cb(null, c); } }; x.send(JSON.stringify({ config: c })); },'
      : 'saveConfig: function (c, cb) { window.__saved = c; if (cb) cb(null); },') +
    'api: function () {} }; 1';

  function start() {
    send('Page.enable', {}, function () {
      send('Page.navigate', { url: APP }, function () {
        setTimeout(function () {
          evalJs(STUB, function () {
            send('Page.reload', {}, function () {
              setTimeout(function () {
                evalJs('(window.__kd = [], document.addEventListener("keydown", function (e) { window.__kd.push(e.keyCode); }, true), window.focus(), 1)', function () {
                  setTimeout(function () {
                    evalJs('typeof window.CleanFrameDebug', function (t) {
                      check('App geladen (Debug-Schnittstelle vorhanden)', t === 'object', String(t));
                      dbg('nach Start');
                      evalJs('JSON.stringify(window.CleanFrameDebug.state().home)', function (homeJson) {
                        var home = [];
                        try { home = JSON.parse(homeJson); } catch (e) {}
                        check('Startseite hat Apps', home.length > 0, home.length + ' Apps');
                        evalJs('JSON.stringify({lang: (window.CleanFrameI18n || {}).lang, probe: (window.CleanFrameI18n ? window.CleanFrameI18n.probe("Rename") : null), T: (window.CleanFrameI18n ? window.CleanFrameI18n.t("Rename") : "-"), gespeichert: (function () { try { return JSON.parse(localStorage.getItem("cleanframe.home.v1") || "null") !== null; } catch (e) { return false; } })()})', function (info) {
                          if (DEBUG) console.log('    sprache: ' + info);
                          ctxTests(home[0]);
                        });
                      });
                    });
                  }, CONFIG_URL ? 1500 : 1200);
                });
              }, 900);
            });
          });
        }, 800);
      });
    });
  }

  function ctxTests(appId) {
    evalJs('(window.CleanFrameDebug.openCtx(' + JSON.stringify(appId) + '), 1)', function () {
      setTimeout(function () {
        evalJs('window.CleanFrameDebug.state().view', function (v) {
          check('Kontextmenue offen', v === 'ctx', String(v));
          evalJs('JSON.stringify(window.CleanFrameDebug.ctxActions())', function (labelsJson) {
            var labels = [];
            try { labels = JSON.parse(labelsJson); } catch (e) {}
            check('Menue bietet Umbenennen an', labels.indexOf('Umbenennen') >= 0, labels.join(' / '));
            check('Menue bleibt kurz (hoechstens 2 Eintraege)', labels.length <= 2, labels.length + ' Eintraege');

            // Von oben nach unten durchgehen, dann zurueck
            var seen = [];
            key('up', function () {
              key('up', function () {
                (function down(n) {
                  focusInfo(function (i) { seen.push(i); });
                  if (n === 0) return afterDown();
                  key('down', function () { down(n - 1); });
                }(labels.length + 1));
              });
            });
            function afterDown() {
              var distinct = {};
              seen.forEach(function (x) { distinct[x] = 1; });
              check('Pfeil unten erreicht alle Eintraege', Object.keys(distinct).length === labels.length,
                    'Positionen: ' + seen.join(','));
              check('letzter Eintrag erreichbar', Math.max.apply(null, seen) === labels.length - 1,
                    'hoechster Index ' + Math.max.apply(null, seen));
              key('up', function () {
                focusInfo(function (i) {
                  check('Pfeil oben bewegt zurueck', i === Math.max(0, labels.length - 2), 'index ' + i);
                  (function up(n) {
                    if (n === 0) return afterUp();
                    key('up', function () { up(n - 1); });
                  }(labels.length + 1));
                });
              });
            }
            function afterUp() {
              focusInfo(function (i) {
                check('Pfeil oben erreicht den ersten Eintrag', i === 0, 'index ' + i);
                key('ok', function () {
                  setTimeout(function () {
                    evalJs('window.CleanFrameDebug.state().view', function (v2) {
                      check('OK auf dem ersten Eintrag oeffnet den Dialog', v2 === 'rename', String(v2));
                      evalJs('JSON.stringify(window.CleanFrameDebug.renameText())', function (before) {
                        send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88, text: 'X', unmodifiedText: 'X' }, function () {
                          send('Input.dispatchKeyEvent', { type: 'char', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88, text: 'X', unmodifiedText: 'X' }, function () {
                            send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 }, function () {
                              evalJs('JSON.stringify(window.CleanFrameDebug.renameText())', function (after) {
                                var a = {}, b = {};
                                try { a = JSON.parse(before); b = JSON.parse(after); } catch (e) {}
                                check('Tippen haengt ein Zeichen an', (b.text || '').length === (a.text || '').length + 1,
                                      a.text + ' -> ' + b.text);
                                key('back', function () {
                                  evalJs('window.CleanFrameDebug.state().view', function (v3) {
                                    check('Zurueck schliesst den Dialog', v3 === 'home', String(v3));
                                    backTest(appId);
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  }, 300);
                });
              });
            }
          });
        });
      }, 450);
    });
  }

  /* Lange OK auf einer Startseiten-Kachel (800 ms halten) -> Kontextmenue. */
  function longPressTest() {
    evalJs('(window.CleanFrameDebug.closeAll ? window.CleanFrameDebug.closeAll() : 1, 1)', function () {
      send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }, function () {
        setTimeout(function () {
          send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, function () {
            setTimeout(function () {
              evalJs('window.CleanFrameDebug.state().view', function (v) {
                check('Lange OK auf einer Kachel oeffnet das Menue', v === 'ctx', String(v));
                key('back', function () { languageTest(); });
              });
            }, 400);
          });
        }, 800);
      });
    });
  }

  /* Einstellungen -> "Uhr und Sprache": Seite da, Umschalten wirkt. */
  function languageTest() {
    evalJs('JSON.stringify(window.CleanFrameDebug.settingsRows ? window.CleanFrameDebug.settingsRows() : null)', function (rowsRaw) {
      var rows = [];
      try { rows = JSON.parse(rowsRaw) || []; } catch (e) {}
      var ids = rows.map(function (r) { return r.id; });
      check('Einstellungen bieten Uhr und Sprache', ids.indexOf('clocklang') >= 0, ids.join(','));
      if (ids.indexOf('clocklang') < 0) { configTests(); return; }
      evalJs('(window.CleanFrameDebug.openSettings("clocklang"), 1)', function () {
        setTimeout(function () {
          evalJs('JSON.stringify(window.CleanFrameDebug.state())', function (r) {
            var st = {};
            try { st = JSON.parse(r); } catch (e) {}
            check('Seite fuer Uhr und Sprache oeffnet', st.view === 'appearance' && st.group === 'clocklang', String(r).slice(0, 90));
            evalJs('JSON.stringify({detailSichtbar: !(document.getElementById("appearance")||{}).hidden, listenInhalt: (document.getElementById("sheetView")||{innerHTML:""}).innerHTML.trim().length, titel: (document.getElementById("appearanceTitle")||{}).textContent})', function (d) {
              var o = {};
              try { o = JSON.parse(d); } catch (e) {}
              check('Detailseite ist sichtbar, Liste geleert', o.detailSichtbar === true && o.listenInhalt === 0, d);
            });
            evalJs('JSON.stringify({langs: window.CleanFrameDebug.langOptions(), clock: window.CleanFrameDebug.clockText()})', function (opts) {
              var o = {};
              try { o = JSON.parse(opts); } catch (e) {}
              check('Sprachoptionen vorhanden', (o.langs || []).indexOf('de') >= 0 && (o.langs || []).indexOf('en') >= 0, opts);
              check('24-Stunden-Anzeige ist Standard', /^\d\d:[0-5]\d$/.test(o.clock || '') && /^([01]\d|2[0-3])$/.test(String(o.clock || '').slice(0, 2)), o.clock);
              evalJs('JSON.stringify({vorher: window.CleanFrameDebug.clockText(), h24: window.CleanFrameDebug.clock24()})', function (c0) {
                evalJs('window.CleanFrameDebug.setClock24(false)', function () {
                  setTimeout(function () {
                    evalJs('JSON.stringify({text: window.CleanFrameDebug.clockText(), h24: window.CleanFrameDebug.clock24()})', function (c1) {
                      var o0 = {}, o1 = {};
                      try { o0 = JSON.parse(c0); o1 = JSON.parse(c1); } catch (e) {}
                      check('12-Stunden-Anzeige wirkt', o1.h24 === false, c0 + ' -> ' + c1);
                      evalJs('window.CleanFrameDebug.setClock24(true)', function () {
                        setTimeout(function () {
                          evalJs('window.CleanFrameDebug.language("en")', function () {
                            setTimeout(function () {
                              evalJs('JSON.stringify({lang: (window.CleanFrameI18n || {}).lang, t: (window.CleanFrameI18n ? window.CleanFrameI18n.t("Language") : "-")})', function (x) {
                                var o2 = {};
                                try { o2 = JSON.parse(x); } catch (e) {}
                                check('Umschalten auf Englisch wirkt', o2.lang === 'en' && o2.t === 'Language', x);
                                evalJs('window.CleanFrameDebug.language("de")', function () {
                                  /* language() laedt die Oberflaeche neu — warten, bis die
                                   * Konfiguration wieder da ist, sonst schreibt der Test zu frueh. */
                                  setTimeout(function () { configTests(); }, 2600);
                                });
                              });
                            }, 500);
                          });
                        }, 700);
                      });
                    });
                  }, 700);
                });
              });
            });
          });
        }, 450);
      });
    });
  }

  function backTest(appId) {
    evalJs('(window.CleanFrameDebug.openCtx(' + JSON.stringify(appId) + '), 1)', function () {
      setTimeout(function () {
        key('back', function () {
          evalJs('window.CleanFrameDebug.state().view', function (v) {
            check('Zurueck schliesst das Kontextmenue', v === 'home', String(v));
            longPressTest();
          });
        });
      }, 400);
    });
  }

  /* Darstellung aendern -> Server -> Neustart: bleibt die Einstellung? */
  function configTests() {
    if (!CONFIG_URL) { finish(); return; }
    evalJs('JSON.stringify(window.CleanFrameDebug.look({}))', function (beforeRaw) {
      var before = {};
      try { before = JSON.parse(beforeRaw); } catch (e) {}
      var target = before.apps === 'icons' ? 'both' : 'icons';
      evalJs('(window.CleanFrameDebug.look({ apps: ' + JSON.stringify(target) + ' }), 1)', function () {
        setTimeout(function () {
        evalJs('JSON.stringify(window.CleanFrameDebug.look({}))', function (changedRaw) {
        var changed = {};
        try { changed = JSON.parse(changedRaw); } catch (e) {}
        check('Darstellung laesst sich aendern', changed.apps === target, before.apps + ' -> ' + changed.apps);
        if (DEBUG) evalJs('JSON.stringify({saved: !!window.__saved, hasSave: typeof (window.FrameDevice && window.FrameDevice.saveConfig), ready: window.CleanFrameDebug.ready(), sync: window.CleanFrameDebug.syncLog(), payloadLook: window.CleanFrameDebug.serverPayload().look})', function (x) { console.log('    sync: ' + x); });
        // Bis zu 6 s auf den Server warten (das Geraet schreibt asynchron)
        (function poll(n) {
          get(CONFIG_URL, function (err, body) {
            var cfg = {};
            try { cfg = (JSON.parse(body) || {}).config || {}; } catch (e) {}
            if ((cfg.look || {}).apps !== target && n > 0) { setTimeout(function () { poll(n - 1); }, 600); return; }
            check('Aenderung steht im Server', (cfg.look || {}).apps === target, 'Server: ' + (cfg.look || {}).apps);
            if ((cfg.look || {}).apps !== target) {
              evalJs('JSON.stringify({ready: window.CleanFrameDebug.ready(), sync: window.CleanFrameDebug.syncLog()})', function (x) { console.log('    sync-verlauf: ' + x); });
            }
            // Neustart der App: frisch laden, Konfiguration erneut holen
            send('Page.reload', {}, function () {
              setTimeout(function () {
                evalJs('window.focus()', function () {
                  evalJs('typeof window.CleanFrameDebug', function (typ) {
                    setTimeout(function () {
                      evalJs('JSON.stringify(window.CleanFrameDebug.look({}))', function (afterRaw) {
                        var after = {};
                        try { after = JSON.parse(afterRaw); } catch (e) {}
                        check('Einstellung ueberlebt den Neustart', after.apps === target, 'nach Neustart: ' + after.apps + ' (vorher ' + before.apps + ')');
                        finish();
                      });
                    }, 1500);
                  });
                });
              }, 500);
            });
          });
        }(10));
        });
        }, 2000);
      });
    });
  }

  ws = wsConnect(wsUrl, function (raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
  }, function () {
    send('Runtime.enable', {}, start);
  });
}

main();
