#!/usr/bin/env node
/*
 * Drives the launcher interface without a TV and without a screenshot.
 *
 * Loads index.html in a headless Chrome (debug port via --port), replaces the
 * device binding with a stub, puts focus on the stage and sends real key presses
 * via Input.dispatchKeyEvent — the same path as the remote control.
 *
 * Focus is the decisive point: the app listens on document, but only while focus
 * is not inside an input field. Without window.focus() the headless window stays
 * unfocused and the keydown never reaches the stage — that was exactly the cause
 * of "arrow down does nothing in the context menu".
 *
 * Starting the browser (once):
 *   chrome --headless=new --no-sandbox --remote-debugging-port=9333 \
 *          --allow-file-access-from-files about:blank
 *
 * Usage: node tools/test-ui-keys.js [--port 9333] [--debug]
 */
'use strict';

var http = require('http');
var net = require('net');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

var PORT = parseInt(arg('port', '9333'), 10);
var DEBUG = process.argv.indexOf('--debug') > 0;
/* Depending on the working directory the home screen sits in the root folder or under app/. */
function appPath() {
  var root = path.resolve(__dirname, '..', 'index.html');
  var alt = path.resolve(__dirname, '..', 'app', 'index.html');
  if (fs.existsSync(root)) return root;
  if (fs.existsSync(alt)) return alt;
  return root;
}
var APP = 'file://' + appPath();
/* With --config <url> a real configuration is loaded (e.g. a locally running
 * server). Without the option the check runs with a stub and without a
 * configuration; then messages are English (key = text). */
var CONFIG_URL = arg('config', '');
var STUB_SERVER = CONFIG_URL ? CONFIG_URL.replace(/\/api\/config$/, '') : '';

function get(url, cb) {
  http.get(url, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () { cb(null, b); });
  }).on('error', function (e) { cb(e); });
}

/* Minimal WebSocket client (text frames only) without dependencies. */
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
    if (err) { console.log('FAIL: no Chrome on port ' + PORT); process.exit(1); }
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
  /* The focus is either on a list entry or on a button in the sheet; both are
   * counted separately so the check does not depend on DOM order. */
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
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' key tests passed');
    console.log('RESULT ' + (results.length - failed.length) + '/' + results.length);
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
                      check('app loaded (debug interface present)', t === 'object', String(t));
                      dbg('nach Start');
                      evalJs('JSON.stringify(window.CleanFrameDebug.state().home)', function (homeJson) {
                        var home = [];
                        try { home = JSON.parse(homeJson); } catch (e) {}
                        check('home screen has apps', home.length > 0, home.length + ' Apps');
                        evalJs('JSON.stringify({lang: (window.CleanFrameI18n || {}).lang, probe: (window.CleanFrameI18n ? window.CleanFrameI18n.probe("Rename") : null), T: (window.CleanFrameI18n ? window.CleanFrameI18n.t("Rename") : "-"), gespeichert: (function () { try { return JSON.parse(localStorage.getItem("cleanframe.home.v1") || "null") !== null; } catch (e) { return false; } })()})', function (info) {
                          if (DEBUG) console.log('    language: ' + info);
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
          check('context menu open', v === 'ctx', String(v));
          evalJs('JSON.stringify(window.CleanFrameDebug.ctxActions())', function (labelsJson) {
            var labels = [];
            try { labels = JSON.parse(labelsJson); } catch (e) {}
            check('menu offers rename', labels.indexOf('Umbenennen') >= 0, labels.join(' / '));
            check('menu stays short (at most 2 entries)', labels.length <= 2, labels.length + ' entries');

            // Walk from top to bottom, then back
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
              check('arrow down reaches all entries', Object.keys(distinct).length === labels.length,
                    'Positionen: ' + seen.join(','));
              check('last entry reachable', Math.max.apply(null, seen) === labels.length - 1,
                    'hoechster Index ' + Math.max.apply(null, seen));
              key('up', function () {
                focusInfo(function (i) {
                  check('arrow up moves back', i === Math.max(0, labels.length - 2), 'index ' + i);
                  (function up(n) {
                    if (n === 0) return afterUp();
                    key('up', function () { up(n - 1); });
                  }(labels.length + 1));
                });
              });
            }
            function afterUp() {
              focusInfo(function (i) {
                check('arrow up reaches the first entry', i === 0, 'index ' + i);
                key('ok', function () {
                  setTimeout(function () {
                    evalJs('window.CleanFrameDebug.state().view', function (v2) {
                      check('OK on the first entry opens the dialog', v2 === 'rename', String(v2));
                      evalJs('JSON.stringify(window.CleanFrameDebug.renameText())', function (before) {
                        send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88, text: 'X', unmodifiedText: 'X' }, function () {
                          send('Input.dispatchKeyEvent', { type: 'char', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88, text: 'X', unmodifiedText: 'X' }, function () {
                            send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'X', code: 'KeyX', windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 88 }, function () {
                              evalJs('JSON.stringify(window.CleanFrameDebug.renameText())', function (after) {
                                var a = {}, b = {};
                                try { a = JSON.parse(before); b = JSON.parse(after); } catch (e) {}
                                check('typing appends one character', (b.text || '').length === (a.text || '').length + 1,
                                      a.text + ' -> ' + b.text);
                                key('back', function () {
                                  evalJs('window.CleanFrameDebug.state().view', function (v3) {
                                    check('back closes the dialog', v3 === 'home', String(v3));
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

  /* Long OK on a home screen tile (hold 800 ms) -> context menu. */
  function longPressTest() {
    evalJs('(window.CleanFrameDebug.closeAll ? window.CleanFrameDebug.closeAll() : 1, 1)', function () {
      send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }, function () {
        setTimeout(function () {
          send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, function () {
            setTimeout(function () {
              evalJs('window.CleanFrameDebug.state().view', function (v) {
                check('long OK on a tile opens the menu', v === 'ctx', String(v));
                key('back', function () { languageTest(); });
              });
            }, 400);
          });
        }, 800);
      });
    });
  }

  /* Settings -> "Clock and language": page there, toggling has an effect. */
  function languageTest() {
    evalJs('JSON.stringify(window.CleanFrameDebug.settingsRows ? window.CleanFrameDebug.settingsRows() : null)', function (rowsRaw) {
      var rows = [];
      try { rows = JSON.parse(rowsRaw) || []; } catch (e) {}
      var ids = rows.map(function (r) { return r.id; });
      check('settings offer clock and language', ids.indexOf('clocklang') >= 0, ids.join(','));
      check('setup can be started again', ids.indexOf('setup') >= 0, ids.join(','));
      evalJs('(window.CleanFrameDebug.openSettings(), 1)', function () {
        (function measure(n) {
          setTimeout(function () {
            evalJs('JSON.stringify(window.CleanFrameDebug.listGeom())', function (g) {
              var o = {};
              try { o = JSON.parse(g); } catch (e) {}
              if ((o.zeilen === 0 || o.letzteUnten === null || o.hinweisOben === null) && n > 0) {
                evalJs('(window.CleanFrameDebug.closeAll(), window.CleanFrameDebug.openSettings(), 1)', function () { measure(n - 1); });
                return;
              }
              check('settings list does not cover the control hint', o.ueberlappt === false,
                    'last row bottom ' + o.letzteUnten + ', hint top ' + o.hinweisOben + ', rows ' + o.zeilen);
            });
          }, 600);
        }(3));
      });
      if (ids.indexOf('clocklang') < 0) { configTests(); return; }
      evalJs('(window.CleanFrameDebug.openSettings("clocklang"), 1)', function () {
        setTimeout(function () {
          evalJs('JSON.stringify(window.CleanFrameDebug.state())', function (r) {
            var st = {};
            try { st = JSON.parse(r); } catch (e) {}
            check('clock and language page opens', st.view === 'appearance' && st.group === 'clocklang', String(r).slice(0, 90));
            evalJs('JSON.stringify({detailSichtbar: !(document.getElementById("appearance")||{}).hidden, listenInhalt: (document.getElementById("sheetView")||{innerHTML:""}).innerHTML.trim().length, titel: (document.getElementById("appearanceTitle")||{}).textContent})', function (d) {
              var o = {};
              try { o = JSON.parse(d); } catch (e) {}
              check('detail page is visible, list cleared', o.detailSichtbar === true && o.listenInhalt === 0, d);
            });
            evalJs('JSON.stringify({langs: window.CleanFrameDebug.langOptions(), clock: window.CleanFrameDebug.clockText()})', function (opts) {
              var o = {};
              try { o = JSON.parse(opts); } catch (e) {}
              check('language options present', (o.langs || []).indexOf('de') >= 0 && (o.langs || []).indexOf('en') >= 0, opts);
              check('24-hour display is the default', /^\d\d:[0-5]\d$/.test(o.clock || '') && /^([01]\d|2[0-3])$/.test(String(o.clock || '').slice(0, 2)), o.clock);
              evalJs('JSON.stringify({vorher: window.CleanFrameDebug.clockText(), h24: window.CleanFrameDebug.clock24()})', function (c0) {
                evalJs('window.CleanFrameDebug.setClock24(false)', function () {
                  setTimeout(function () {
                    evalJs('JSON.stringify({text: window.CleanFrameDebug.clockText(), h24: window.CleanFrameDebug.clock24()})', function (c1) {
                      var o0 = {}, o1 = {};
                      try { o0 = JSON.parse(c0); o1 = JSON.parse(c1); } catch (e) {}
                      check('12-hour display takes effect', o1.h24 === false, c0 + ' -> ' + c1);
                      evalJs('window.CleanFrameDebug.setClock24(true)', function () {
                        setTimeout(function () {
                          evalJs('window.CleanFrameDebug.language("en")', function () {
                            setTimeout(function () {
                              evalJs('JSON.stringify({lang: (window.CleanFrameI18n || {}).lang, t: (window.CleanFrameI18n ? window.CleanFrameI18n.t("Language") : "-")})', function (x) {
                                var o2 = {};
                                try { o2 = JSON.parse(x); } catch (e) {}
                                check('switching to English takes effect', o2.lang === 'en' && o2.t === 'Language', x);
                                evalJs('window.CleanFrameDebug.language("de")', function () {
                                  /* language() reloads the interface — wait until the
                                   * configuration is back, otherwise the test writes too early. */
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
            check('back closes the context menu', v === 'home', String(v));
            longPressTest();
          });
        });
      }, 400);
    });
  }

  /* Change appearance -> server -> restart: does the setting survive? */
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
        check('appearance can be changed', changed.apps === target, before.apps + ' -> ' + changed.apps);
        if (DEBUG) evalJs('JSON.stringify({saved: !!window.__saved, hasSave: typeof (window.FrameDevice && window.FrameDevice.saveConfig), ready: window.CleanFrameDebug.ready(), sync: window.CleanFrameDebug.syncLog(), payloadLook: window.CleanFrameDebug.serverPayload().look})', function (x) { console.log('    sync: ' + x); });
        // Wait up to 6 s for the server (the device writes asynchronously)
        (function poll(n) {
          get(CONFIG_URL, function (err, body) {
            var cfg = {};
            try { cfg = (JSON.parse(body) || {}).config || {}; } catch (e) {}
            if ((cfg.look || {}).apps !== target && n === 6) {
              /* Network hiccup while writing: retry once. */
              evalJs('(window.CleanFrameDebug.look({ apps: ' + JSON.stringify(target) + ' }), 1)', function () {});
            }
            if ((cfg.look || {}).apps !== target && n > 0) { setTimeout(function () { poll(n - 1); }, 600); return; }
            check('change is in the server', (cfg.look || {}).apps === target, 'server: ' + (cfg.look || {}).apps);
            if ((cfg.look || {}).apps !== target) {
              evalJs('JSON.stringify({ready: window.CleanFrameDebug.ready(), sync: window.CleanFrameDebug.syncLog()})', function (x) { console.log('    sync history: ' + x); });
            }
            // Restart the app: load fresh, fetch the configuration again
            send('Page.reload', {}, function () {
              setTimeout(function () {
                evalJs('window.focus()', function () {
                  evalJs('typeof window.CleanFrameDebug', function (typ) {
                    setTimeout(function () {
                      evalJs('JSON.stringify(window.CleanFrameDebug.look({}))', function (afterRaw) {
                        var after = {};
                        try { after = JSON.parse(afterRaw); } catch (e) {}
                        check('setting survives the restart', after.apps === target, 'after restart: ' + after.apps + ' (before ' + before.apps + ')');
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
