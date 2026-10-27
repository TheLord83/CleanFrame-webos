#!/usr/bin/env node
/*
 * Checks the Home Assistant status strip on the home screen.
 *
 * Background: the entities picked in the hub were stored but never shown
 * anywhere - the selection was a dead end. This script measures the visible
 * result: does the strip appear, does it carry the chosen labels, are states
 * translated, does it follow a new value, and does it disappear again when the
 * selection is cleared.
 *
 * A stub Home Assistant answers /api/states, so the test does not need a real
 * instance. What is measured is the DOM after a wait, never an intermediate
 * counter.
 *
 * Prerequisites (tools/check-all.sh does this automatically):
 *   - Chrome with --remote-debugging-port=9333
 *   - config server on 127.0.0.1:8484
 *
 * Usage: node tools/test-ha-strip.js [--port 9333] [--server http://127.0.0.1:8484] [--wait 12000]
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
var WAIT_MS = parseInt(arg('wait', '12000'), 10);

/* The launcher app talks to a fixed address (device.js: 127.0.0.1:8484), so the
 * test has to use that port too. If nothing answers there, the test starts its
 * own server with a temporary configuration and stops it afterwards — a stage
 * that silently measures against a dead port is worthless. */
var REPO = path.resolve(__dirname, '..');
var SERVER = 'http://127.0.0.1:8484';
var serverProc = null;

function ensureServer(cb) {
  req('GET', SERVER + '/api/health', null, function (err, code) {
    if (code === 200) { console.log('    using the running config server on 8484'); return cb(true); }
    /* A server from an earlier stage may still be dying; a second listener on
     * 8484 fails with EADDRINUSE and this stage then measures against nothing.
     * So: wait for the port to be free, and keep the child's output for the case
     * that it still does not come up (a silent stage is worth nothing). */
    waitForFreePort(0, function () {
      startOwnServer(1, cb);
    });
  });
}

function waitForFreePort(attempt, done) {
  req('GET', SERVER + '/api/health', null, function (e, code) {
    if (code !== 200 || attempt >= 15) return done();
    setTimeout(function () { waitForFreePort(attempt + 1, done); }, 300);
  });
}

function startOwnServer(tryNo, cb) {
  var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cf-strip-'));
  var logPath = path.join(tmp, 'server.log');
  var env = Object.assign({}, process.env, {
    CF_PORT: '8484',
    CF_CONFIG: path.join(tmp, 'config.json'),
    CF_CLIENT_LOG: path.join(tmp, 'client.log'),
    CF_STUB_APPS: path.join(REPO, 'web', 'test', 'fixtures', 'apps-stub.json'),
    CF_WALL_DIR: path.join(REPO, 'app', 'assets', 'wallpapers'),
    CF_GLASSHOUSE: 'http://127.0.0.1:9'
  });
  var out = fs.openSync(logPath, 'a');
  serverProc = require('child_process').spawn('node', ['server.js'], {
    cwd: path.join(REPO, 'web'), env: env, stdio: ['ignore', out, out]
  });
  var start = Date.now();
  (function poll() {
    req('GET', SERVER + '/api/health', null, function (e2, c2) {
      if (c2 === 200) { console.log('    started an own config server on 8484'); return cb(true); }
      if (Date.now() - start > 15000) {
        var tail = '';
        try { tail = fs.readFileSync(logPath, 'utf8').split('\n').slice(-8).join('\n'); } catch (e3) {}
        console.log('    own config server did not come up (attempt ' + tryNo + '), server log:\n' + tail);
        try { if (serverProc) serverProc.kill('SIGKILL'); } catch (e4) {}
        if (tryNo < 2) return setTimeout(function () { startOwnServer(tryNo + 1, cb); }, 2000);
        return cb(false);
      }
      setTimeout(poll, 200);
    });
  })();
}

function appPath() {
  var alt = path.resolve(__dirname, '..', 'app', 'index.html');
  if (fs.existsSync(alt)) return alt;
  return path.resolve(__dirname, '..', 'index.html');
}
var APP = 'file://' + appPath();

/* ---------- stub Home Assistant ---------- */
var haStates = [
  { entity_id: 'sensor.wohnzimmer_temperatur', state: '21.4', attributes: { friendly_name: 'Wohnzimmer Temperatur', unit_of_measurement: '°C' } },
  { entity_id: 'light.wohnzimmer_decke', state: 'on', attributes: { friendly_name: 'Wohnzimmer Decke' } },
  { entity_id: 'binary_sensor.terrassentuer', state: 'open', attributes: { friendly_name: 'Terrassentür' } },
  { entity_id: 'sensor.kaputt', state: 'unavailable', attributes: { friendly_name: 'Kaputter Sensor', unit_of_measurement: '°C' } }
];

var haCalls = [];

function haFind(id) {
  var hit = null;
  haStates.forEach(function (s) { if (s.entity_id === id) hit = s; });
  return hit;
}

var haServer = http.createServer(function (req, res) {
  if (req.url.indexOf('/api/services/') === 0) {
    var raw = '';
    req.on('data', function (c) { raw += c; });
    req.on('end', function () {
      var payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch (e) {}
      var domain = req.url.split('/')[3];
      haCalls.push({ path: req.url, domain: domain, entity_id: payload.entity_id || '' });
      var target = haFind(payload.entity_id);
      var next = null;
      if (target) {
        next = target.state === 'on' ? 'off' : 'on';
        target.state = next;
      }
      var answer = target ? [{ entity_id: target.entity_id, state: target.state }] : [];
      var out = JSON.stringify(answer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out);
    });
    return;
  }
  if (req.url.indexOf('/api/states') !== 0) { res.writeHead(404); res.end('{}'); return; }
  var body = JSON.stringify(haStates);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});

haServer.listen(0, '127.0.0.1', function () {
  var haPort = haServer.address().port;
  main(haPort);
});

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok });
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail !== undefined ? '  [' + detail + ']' : ''));
}

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
      cb(null, res.statusCode, json);
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

function baseFixture(haPort, entities) {
  return {
    schemaVersion: 1, rev: 0, lang: 'de',
    look: { bg: 'photo', layout: 'dock', apps: 'both', controls: 'both', focus: 'glass', material: 'soft', wall: 'forest', font: 'manrope', clock: true, clock24: true },
    home: [
      { appId: 'netflix', name: 'Erste' },
      { appId: 'youtube.leanback.v4', name: 'Zweite' }
    ],
    screensaver: { enabled: false, minutes: 30, variant: 'default' },
    ui: { senior: false, textScale: 100, cursor: 'focus' },
    onboarding: { done: true, version: 1 },
    integrations: {
      ha: { url: 'http://127.0.0.1:' + haPort, token: 'testtoken', entities: entities },
      mqtt: { url: '', user: '', password: '', prefix: 'lgtv' }
    }
  };
}

var CHOSEN = [
  { id: 'sensor.wohnzimmer_temperatur', label: 'Temperatur' },
  { id: 'light.wohnzimmer_decke', label: '' },
  { id: 'sensor.kaputt', label: '' }
];

/* The first write after the previous stage can still hit a server that is
 * restarting; a short retry beats a red run for a timing reason. */
function putFixture(haPort, entities, tries, cb) {
  req('PUT', SERVER + '/api/config', { config: baseFixture(haPort, entities) }, function (err, code) {
    if (code === 200) return cb(null, code);
    if (tries > 1) return setTimeout(function () { putFixture(haPort, entities, tries - 1, cb); }, 700);
    cb(err || ('HTTP ' + code), code);
  });
}

function main(haPort) {
  ensureServer(function (up) {
    if (!up) {
      console.log('FAIL: the configuration server did not come up');
      process.exit(1);
    }
    runWithRetry(haPort);
  });
}

function runWithRetry(haPort) {
  putFixture(haPort, CHOSEN, 4, function (err, code) {
    if (code !== 200) {
      console.log('FAIL: test server does not accept the initial configuration (' + (err && (err.code || err.message) || err) + ', HTTP ' + code + ')');
      console.log('      server: ' + SERVER);
      req('GET', SERVER + '/api/health', null, function (e2, c2) {
        console.log('      health: ' + (e2 ? (e2.code || e2.message) : ('HTTP ' + c2)));
        process.exit(1);
      });
      return;
    }
    req('GET', 'http://127.0.0.1:' + PORT + '/json/list', null, function (err2, c2, list) {
      if (err2) { console.log('FAIL: no Chrome on port ' + PORT); process.exit(1); }
      if (!Array.isArray(list)) list = [];
      var target = list.filter(function (t) { return t.type === 'page'; })[0] || list[0];
      if (!target) { console.log('FAIL: no page target'); process.exit(1); }
      run(target.webSocketDebuggerUrl, haPort);
    });
  });
}

function run(wsUrl, haPort) {
  var id = 0, pending = {}, ws, ready = false, queue = [];

  function send(method, params, cb) {
    if (!ready) { queue.push([method, params, cb]); return; }
    var mid = ++id;
    pending[mid] = cb || function () {};
    ws.send({ id: mid, method: method, params: params });
  }
  function evalJs(expr, cb) {
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (r) {
      var v = r.result && r.result.result;
      cb(v ? v.value : undefined);
    });
  }
  function wait(ms, cb) { setTimeout(cb, ms); }
  /* Real key presses over CDP, the same path as the remote on the TV. The stage
   * only sees them while the window has focus. */
  var KEYS = { up: [38, 'ArrowUp'], down: [40, 'ArrowDown'], left: [37, 'ArrowLeft'], right: [39, 'ArrowRight'], ok: [13, 'Enter'], back: [461, 'Backspace'] };
  function key(name, cb) {
    var k = KEYS[name];
    send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: k[1], code: k[1], windowsVirtualKeyCode: k[0],
      nativeVirtualKeyCode: k[0], text: name === 'ok' ? '\r' : undefined
    }, function () {
      send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: k[1], code: k[1], windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0]
      }, function () { setTimeout(cb, 350); });
    });
  }
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
  function getCfg(cb) {
    req('GET', SERVER + '/api/config', null, function (e, code, data) {
      cb(code === 200 && data && data.config ? data.config : null);
    });
  }
  function putCfg(cfg, cb) {
    req('PUT', SERVER + '/api/config', { config: cfg }, function (e, code) {
      if (code !== 200) console.log('    note: server answered ' + code);
      cb();
    });
  }

  function finish() {
    var failed = results.filter(function (r) { return !r.ok; }).length;
    if (ws) ws.close();
    haServer.close();
    if (serverProc) { try { serverProc.kill(); } catch (e) {} }
    console.log('\nRESULT ' + (results.length - failed) + '/' + results.length);
    process.exit(failed ? 1 : 0);
  }

  ws = wsConnect(wsUrl, function (text) {
    var msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
  }, function () {
    ready = true;
    queue.splice(0).forEach(function (q) { send(q[0], q[1], q[2]); });
    send('Page.enable', {}, function () {
      send('Page.navigate', { url: APP }, function () {
        wait(2500, stepStrip);
      });
    });
  });

  function chipsExpr() {
    return "(function(){var s=document.getElementById('haStrip');if(!s||s.hidden)return '';return Array.prototype.map.call(s.children,function(c){var n=c.querySelector('.ha-chip-name'),v=c.querySelector('.ha-chip-value');return (n?n.textContent:'')+'='+(v?v.textContent:'');}).join('|');})()";
  }

  /* 1. The strip appears with one chip per chosen entity, labels and values right. */
  /* Any JavaScript error during the run is collected: a page that throws while
   * rendering shows an empty list, and a test that only counts elements would
   * call that a layout problem instead of a broken script. */
  function stepStrip() {
    evalJs("(function(){window.__cfErrs=[];window.addEventListener('error',function(e){window.__cfErrs.push(String(e.message)+' @ '+(e.filename||'').split('/').pop()+':'+e.lineno);});return 1;})()", function () {
    waitFor("(function(){var s=document.getElementById('haStrip');return !!(s && !s.hidden && s.children.length===3);})()", function (ok, v) {
      check('status strip shows three chips', ok, String(v));
      if (!ok) return finish();
      evalJs(chipsExpr(), function (text) {
        var t = String(text || ''), parts = t.split('|');
        check('own label wins over the Home Assistant name', parts[0] === 'Temperatur=21.4 °C', parts[0]);
        check('state is translated (on -> An)', parts[1] === 'Wohnzimmer Decke=An', parts[1]);
        check('missing reading says so, without unit', parts[2] === 'Kaputter Sensor=Nicht verfügbar', parts[2]);
        evalJs("(window.__cfErrs||[]).join(' || ')", function (errs) {
          check('no JavaScript errors while drawing', !errs, String(errs || ''));
          stepPosition();
        });
      });
    });
    });
  }

  /* 2. The strip sits above the dock and does not overlap it. */
  function stepPosition() {
    evalJs("(function(){var s=document.getElementById('haStrip'),d=document.getElementById('dock');var sr=s.getBoundingClientRect(),dr=d.getBoundingClientRect();return JSON.stringify({sBottom:Math.round(sr.bottom),dTop:Math.round(dr.top)});})()", function (v) {
      var o = {};
      try { o = JSON.parse(String(v)); } catch (e) {}
      check('strip ends above the dock', o.sBottom <= o.dTop, JSON.stringify(o));
      stepToggle();
    });
  }

  /* 2b. The chip can be reached with the remote and switches the entity. */
  function stepToggle() {
    evalJs('window.focus(), 1', function () {
      key('down', function () {
        evalJs("(function(){var b=document.querySelector('#haStrip .ha-chip.is-focus');return b?b.textContent:'keiner';})()", function (focused) {
          check('down from the dock focuses a chip', String(focused).indexOf('Wohnzimmer Decke') >= 0, focused);
          key('ok', function () {
            waitFor(chipsExpr() + ".indexOf('Wohnzimmer Decke=Aus') >= 0", function (ok, v) {
              check('OK switches the light off', ok, String(v));
              var call = null;
              haCalls.forEach(function (c) { if (c.entity_id === 'light.wohnzimmer_decke') call = c; });
              check('the hub called the light service', !!call && call.domain === 'light' && call.path.indexOf('/toggle') > 0, call && call.path);
              key('up', function () {
                evalJs("document.querySelectorAll('#haStrip .ha-chip.is-focus').length", function (left) {
                  check('up leaves the strip again', String(left) === '0', String(left));
                  stepEntities();
                });
              });
            });
          });
        });
      });
    });
  }

  /* 2c. The TV has its own page for the values: a checkbox per chosen entity
   * and the name editable there. */
  function openValuesPage(cb) {
    key('up', function () {            /* dock -> utilities */
      key('right', function () {
        key('right', function () {     /* -> settings */
          key('ok', function () {
            key('down', function () { key('down', function () { key('down', function () {
              key('down', function () { key('down', function () { key('down', function () {
                key('ok', function () { cb(); });
              }); }); });
            }); }); });
          });
        });
      });
    });
  }

  function stepEntities() {
    evalJs('window.focus(), 1', function () {
      openValuesPage(function () {
        evalJs("JSON.stringify({rows:document.querySelectorAll('#sheetView .ent-line').length,title:(document.querySelector('#sheetView .s-title')||{}).textContent,errs:(window.__cfErrs||[]).slice(-3)})", function (info) {
          var n = '0';
          try { n = String(JSON.parse(String(info)).rows); } catch (e) {}
          check('settings opens the values page with every chosen value', n === '3', String(info));
          key('ok', function () {
            waitFor("document.querySelectorAll('#haStrip .ha-chip').length === 2", function (ok, v) {
              check('left switches a value out of the strip', ok, String(v));
              getCfg(function (cfg) {
                var ents = (((cfg || {}).integrations || {}).ha || {}).entities || [];
                check('the choice is stored on the server', ents[0] && ents[0].shown === false, JSON.stringify(ents[0] || null));
                evalJs("(document.querySelector('#sheetView .ent-line .ent-name-main')||{}).textContent", function (name) {
                  check('a hidden value keeps its own name', String(name) === 'Temperatur', String(name));
                key('ok', function () {
                  waitFor("document.querySelectorAll('#haStrip .ha-chip').length === 3", function (ok2, v2) {
                    check('switching it back shows it again', ok2, String(v2));
                    key('back', function () { key('back', function () { stepValueChange(); }); });
                  });
                });
                });
              });
            });
          });
        });
      });
    });
  }

  /* 3. A new value from Home Assistant reaches the strip (no restart). */
  function stepValueChange() {
    haStates[0].state = '23.8';
    /* Same selection, new revision: the launcher re-reads the values. */
    putCfg(baseFixture(haPort, CHOSEN), function () {
      waitFor(chipsExpr() + ".indexOf('23.8') >= 0", function (ok, v) {
        check('new value reaches the strip', ok, String(ok));
        stepEmpty();
      });
    });
  }

  /* 4. No selection, no strip. */
  function stepEmpty() {
    putCfg(baseFixture(haPort, []), function () {
      waitFor("(function(){var s=document.getElementById('haStrip');return !!(s && s.hidden);})()", function (ok, v) {
        check('without a selection the strip stays hidden', ok, String(v));
        finish();
      });
    });
  }
}
