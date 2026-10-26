#!/usr/bin/env node
/*
 * Checks live adoption: changes from the web interface must reach the running
 * launcher without a restart.
 *
 * Background: three bugs shared the same shape — the value arrived on the device
 * but the display stayed old (build key without name, icon or text size;
 * appearance only half applied). Exactly those cases are what this script checks
 * without a TV: it loads the home screen in a headless Chrome against a local
 * config server, changes the configuration over the HTTP interface and measures
 * the DOM.
 *
 * What is measured is always the visible result with a wait (up to 12 s), not
 * the revision counter: the counter was already incremented while the display
 * was still old — that is exactly why the bug went unnoticed.
 *
 * Prerequisites (tools/check-all.sh does this automatically):
 *   - Chrome with --remote-debugging-port=9333
 *   - config server on 127.0.0.1:8484
 *
 * Usage: node tools/test-live-apply.js [--port 9333] [--server http://127.0.0.1:8484] [--wait 12000]
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
var SERVER = arg('server', 'http://127.0.0.1:8484').replace(/\/$/, '');
var DEBUG = process.argv.indexOf('--debug') > 0;
var WAIT_MS = parseInt(arg('wait', '12000'), 10);

function appPath() {
  var root = path.resolve(__dirname, '..', 'index.html');
  var alt = path.resolve(__dirname, '..', 'app', 'index.html');
  if (fs.existsSync(root)) return root;
  if (fs.existsSync(alt)) return alt;
  return root;
}
var APP = 'file://' + appPath();

/* Fixed initial configuration — the test does not depend on what was in the
 * test server before. Three tiles, list view, 100% text size. */
var FIXTURE = {
  schemaVersion: 1, rev: 0, lang: 'de',
  look: { bg: 'photo', layout: 'list', apps: 'both', controls: 'both', focus: 'glass', material: 'soft', wall: 'forest', font: 'manrope', clock: true, clock24: true },
  home: [
    { appId: 'netflix', name: 'Erste' },
    { appId: 'youtube.leanback.v4', name: 'Zweite' },
    { appId: 'com.webos.app.enactbrowser', name: 'Dritte' }
  ],
  screensaver: { enabled: false, minutes: 30, variant: 'default' },
  ui: { senior: false, textScale: 100, cursor: 'focus' },
  onboarding: { done: true, version: 1 },
  integrations: { ha: { url: '', token: '', entities: [] }, mqtt: { url: '', user: '', password: '', prefix: 'lgtv' } }
};

/* ---------- HTTP without dependencies ---------- */
function req(method, url, body, cb) {
  var u = new URL(url);
  var data = body ? Buffer.from(JSON.stringify(body)) : null;
  var r = http.request({
    host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: method,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
  }, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var json = null;
      try { json = JSON.parse(b); } catch (e) {}
      cb(null, res.statusCode, json, b);
    });
  });
  r.on('error', function (e) { cb(e); });
  if (data) r.write(data);
  r.end();
}

/* ---------- minimal WebSocket client (text frames only) ---------- */
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

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok });
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail !== undefined ? '  [' + detail + ']' : ''));
}

function main() {
  req('PUT', SERVER + '/api/config', { config: FIXTURE }, function (err, code) {
    if (code !== 200) {
      console.log('FAIL: test server does not accept the initial configuration (HTTP ' + code + ')');
      process.exit(1);
    }
    req('GET', 'http://127.0.0.1:' + PORT + '/json/list', null, function (err2, c2, j2, raw) {
      if (err2) { console.log('FAIL: no Chrome on port ' + PORT); process.exit(1); }
      var list = [];
      try { list = JSON.parse(raw); } catch (e) {}
      var page = list.filter(function (t) { return t.type === 'page'; })[0];
      if (!page) { console.log('FAIL: no page target'); process.exit(1); }
      run(page.webSocketDebuggerUrl);
    });
  });
}

function run(wsUrl) {
  var id = 0, pending = {}, ws, ORIG = null;

  function send(method, params, cb) {
    var mid = ++id;
    pending[mid] = cb || function () {};
    ws.send({ id: mid, method: method, params: params });
  }
  function evalJs(expr, cb) {
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (r) {
      if (DEBUG && r.result && r.result.exceptionDetails) {
        console.log('    js-error: ' + JSON.stringify(r.result.exceptionDetails.text));
      }
      var v = r.result && r.result.result;
      cb(v ? v.value : undefined);
    });
  }
  function wait(ms, cb) { setTimeout(cb, ms); }

  /* Wait for the visible result — not for the revision counter. */
  function waitFor(expr, cb) {
    var start = Date.now();
    (function poll() {
      evalJs(expr, function (v) {
        if (v) return cb(true, v);
        if (Date.now() - start > WAIT_MS) return cb(false, v);
        wait(250, poll);
      });
    })();
  }

  function readCfg(cb) {
    req('GET', SERVER + '/api/config', null, function (e, code, json) { cb(json && json.config); });
  }
  function patchCfg(fn, cb) {
    readCfg(function (cfg) {
      if (!cfg) { console.log('FAIL: no configuration from the server'); return finish(); }
      fn(cfg);
      req('PUT', SERVER + '/api/config', { config: cfg }, function (e, code) {
        if (code !== 200) console.log('    note: server answered ' + code);
        cb(cfg);
      });
    });
  }

  var STUB = 'window.FrameDevice = {' +
    'launchApp: function (id, cb) { window.__launched = id; if (cb) cb(null); },' +
    'launch: function (b, cb) { if (cb) cb(null); },' +
    'apps: function (cb) { cb(null, []); },' +
    'home: function (cb) { if (cb) cb(null); },' +
    'settings: function (cb) { if (cb) cb(null); },' +
    'art: function (cb) { if (cb) cb(null); },' +
    'loadConfig: function (cb) { var x = new XMLHttpRequest(); x.open("GET", ' + JSON.stringify(SERVER + '/api/config') + ', true); x.onreadystatechange = function () { if (x.readyState !== 4) return; var d = null; try { d = JSON.parse(x.responseText); } catch (e) {} cb(null, d && d.config || null); }; x.send(); },' +
    'saveConfig: function (c, cb) { var x = new XMLHttpRequest(); x.open("PUT", ' + JSON.stringify(SERVER + '/api/config') + ', true); x.setRequestHeader("Content-Type", "application/json"); x.onreadystatechange = function () { if (x.readyState === 4) { if (cb) cb(null, c); } }; x.send(JSON.stringify({ config: c })); },' +
    'api: function () {} }; 1';

  /* ---------------- Sequence ---------------- */

  function boot() {
    send('Page.enable', {}, function () {
      send('Page.navigate', { url: APP }, function () {
        wait(900, function () {
          evalJs(STUB, function () {
            send('Page.reload', {}, function () {
              wait(2000, function () {
                waitFor('(function(){var n=document.querySelector(".ph-name"); return !!(n && n.textContent === "' + FIXTURE.home[0].name + '");})()', function (ok) {
                  if (!ok) { console.log('FAIL: app did not show the initial configuration'); return finish(); }
                  readCfg(function (cfg) {
                    ORIG = JSON.parse(JSON.stringify(cfg));
                    console.log('Home screen loaded: ' + cfg.home.length + ' tiles, layout ' + cfg.look.layout + ', wallpaper ' + cfg.look.wall);
                    stepName();
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  /* 1) tile name in the list view */
  function stepName() {
    patchCfg(function (c) { c.home[0].name = 'Pruefname'; }, function () {
      waitFor('Array.prototype.some.call(document.querySelectorAll(".ph-name"), function (e) { return e.textContent === "Pruefname"; })', function (ok) {
        evalJs('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".ph-name"), function (e) { return e.textContent; }))', function (v) {
          check('tile name arrives live (list)', ok, v);
          stepIcon();
        });
      });
    });
  }

  /* 2) icon change in the list view */
  function stepIcon() {
    patchCfg(function (c) { c.home[0].icon = 'ard'; }, function () {
      waitFor('(function(){var r=document.querySelector(".ph-row"); return !!(r && r.innerHTML.indexOf("ard") >= 0);})()', function (ok) {
        evalJs('(function(){var r=document.querySelector(".ph-row"); return r ? r.innerHTML.indexOf("ard") >= 0 : false;})()', function (v) {
          check('icon change arrives live (list)', ok, String(v));
          stepWall();
        });
      });
    });
  }

  /* 3) wallpaper — value AND image file */
  function stepWall() {
    patchCfg(function (c) { c.look.wall = 'night'; }, function () {
      waitFor('(function(){var p=document.getElementById("photo"); return !!(p && p.src.split("/").pop() === "night.jpg");})()', function (ok) {
        evalJs('(function(){var p=document.getElementById("photo"); return p ? p.src.split("/").pop() : "no-image";})()', function (v) {
          check('wallpaper is swapped (night.jpg)', ok, v);
          stepScale();
        });
      });
    });
  }

  /* 4) text size 150% */
  function stepScale() {
    patchCfg(function (c) { c.ui.textScale = 150; c.ui.senior = false; }, function () {
      waitFor('(function(){var n=document.querySelector(".ph-name"); return !!(n && Math.abs(parseFloat(getComputedStyle(n).fontSize) - 132) <= 3);})()', function (ok) {
        evalJs('(function(){var n=document.querySelector(".ph-name"); return n ? parseFloat(getComputedStyle(n).fontSize) : -1;})()', function (v) {
          check('text size 150% gives 132 px', ok, v + ' px');
          stepSenior();
        });
      });
    });
  }

  /* 5) senior mode raises 100% to at least 125% */
  function stepSenior() {
    patchCfg(function (c) { c.ui.textScale = 100; c.ui.senior = true; }, function () {
      waitFor('(function(){var n=document.querySelector(".ph-name"); return !!(n && Math.abs(parseFloat(getComputedStyle(n).fontSize) - 110) <= 3);})()', function (ok) {
        evalJs('(function(){var n=document.querySelector(".ph-name"); return n ? parseFloat(getComputedStyle(n).fontSize) : -1;})()', function (v) {
          check('senior mode raises 100% to 110 px', ok, v + ' px');
          stepSeniorOff();
        });
      });
    });
  }

  /* 6) senior mode off again -> back to 88 px */
  function stepSeniorOff() {
    patchCfg(function (c) { c.ui.senior = false; }, function () {
      waitFor('(function(){var n=document.querySelector(".ph-name"); return !!(n && Math.abs(parseFloat(getComputedStyle(n).fontSize) - 88) <= 3);})()', function (ok) {
        evalJs('(function(){var n=document.querySelector(".ph-name"); return n ? parseFloat(getComputedStyle(n).fontSize) : -1;})()', function (v) {
          check('senior mode off gives 88 px again', ok, v + ' px');
          stepDock();
        });
      });
    });
  }

  /* 7) the "Dock" layout follows the same name change */
  function stepDock() {
    patchCfg(function (c) { c.look.layout = 'dock'; }, function () {
      waitFor('Array.prototype.some.call(document.querySelectorAll("#track .tile"), function (t) { return (t.textContent || "").indexOf("Pruefname") >= 0; })', function (ok) {
        evalJs('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#track .tile"), function (t) { return (t.textContent || "").trim(); }).slice(0, 4))', function (v) {
          check('tile name arrives live (dock)', ok, v);
          stepLanguage();
        });
      });
    });
  }

  /* 8) a language change from the server must rebuild the page: swapping the
   * translation table alone leaves the built texts in the old language. */
  function stepLanguage() {
    patchCfg(function (c) { c.lang = 'en'; }, function () {
      waitFor('document.body.innerText.indexOf("All apps") >= 0', function (ok) {
        evalJs('(function(){ var u=document.getElementById("utils"); return u ? (u.innerText || "").replace(/\\n/g, " | ") : "no-util-bar"; })()', function (v) {
          check('language from the server rebuilds the page', ok, v);
          /* Leave the browser as we found it for the next run. */
          evalJs('(function(){ try { localStorage.removeItem("cleanframe.lang"); } catch (e) {} return 1; })()', function () {
            stepSpinner();
          });
        });
      });
    });
  }

  /* 9) spinner in the web interface: on during the action, off afterwards */
  function stepSpinner() {
    send('Page.navigate', { url: SERVER + '/' }, function () {
      wait(3000, function () {
        evalJs('!!document.getElementById("tvSpin")', function (has) {
          if (!has) { check('spinner present in the interface', false, 'not found'); return restore(); }
          evalJs('(function(){var b=document.querySelector("[data-wall]"); if(b){b.click(); return "klick";} return "no-button";})()', function () {
            waitFor('(document.getElementById("tvSpin")||{}).className === "spin on"', function (an) {
              check('spinner runs during the action', an, an ? 'on' : 'stayed off');
              waitFor('(function(){var e=document.getElementById("tvSpin"); return !!(e && e.className.indexOf("on") < 0);})()', function (aus) {
                check('spinner stops afterwards', aus, aus ? 'off' : 'keeps running');
                stepHubSelftest();
              });
            });
          });
        });
      });
    });
  }

  /* 10) the interface's own self-test (?selftest=ui) has to end green. It is the
   * only place where the checks of the browser page itself live, so a stage that
   * nobody calls would be green for the wrong reason. */
  function stepHubSelftest() {
    send('Page.navigate', { url: SERVER + '/?selftest=ui' }, function () {
      wait(1500, function () {
        (function poll(n) {
          evalJs('document.title', function (t) {
            if (t !== 'SELFTEST-OK' && t !== 'SELFTEST-FAIL' && n < 40) {
              return wait(250, function () { poll(n + 1); });
            }
            evalJs('(function(){var o=document.getElementById("out"); var bad=[]; try { JSON.parse(o.textContent).steps.forEach(function(s){ if(!s.ok) bad.push(s.name); }); } catch(e) {} return bad.join(" | "); })()', function (bad) {
              check('hub self-test is green', t === 'SELFTEST-OK', t === 'SELFTEST-OK' ? 'all steps green' : (bad || String(t)));
              restore();
            });
          });
        })(0);
      });
    });
  }

  /* Write the initial configuration back so the test is repeatable. */
  function restore() {
    if (!ORIG) return finish();
    ORIG.rev = 0;
    req('PUT', SERVER + '/api/config', { config: ORIG }, function () {
      console.log('  info  initial configuration restored');
      finish();
    });
  }

  function finish() {
    var failed = results.filter(function (r) { return !r.ok; });
    if (!results.length) {
      console.log('FAIL: no check ran');
      failed = [1];
    }
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' live-apply checks passed');
    console.log('RESULT ' + (results.length - failed.length) + '/' + results.length);
    try { ws.close(); } catch (e) {}
    process.exit(failed.length ? 1 : 0);
  }

  ws = wsConnect(wsUrl, function (msg) {
    var o = {};
    try { o = JSON.parse(msg); } catch (e) { return; }
    if (o.id && pending[o.id]) { var cb = pending[o.id]; delete pending[o.id]; cb(o); }
  }, boot);
}

main();
