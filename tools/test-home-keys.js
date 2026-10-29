/*
 * Presses keys on the real launcher and checks where the cursor goes and how big
 * a tile is. Runs headless against the package in app/ with a local hub stub, so
 * a navigation change or a tile size can be checked without the television.
 *
 *   node tools/test-home-keys.js --port 9333 --config http://127.0.0.1:8484/api/config
 *
 * Exit code 0 when every check passes.
 */
'use strict';

var http = require('http');
var net = require('net');
var crypto = require('crypto');
var path = require('path');

var args = {};
process.argv.slice(2).forEach(function (a, i, all) {
  if (a.indexOf('--') === 0) args[a.slice(2)] = all[i + 1] && all[i + 1].indexOf('--') !== 0 ? all[i + 1] : true;
});
var PORT = parseInt(args.port || '9333', 10);
var CONFIG_URL = args.config || '';
var ROOT = path.dirname(__dirname);
var PAGE = 'file://' + path.join(ROOT, 'app', 'index.html');

var results = [];
function check(name, ok, detail) {
  results.push({ ok: !!ok, name: name, detail: detail || '' });
  if (!ok) console.log('  FAIL  ' + name + '  ->  ' + (detail || ''));
}

/* ---- minimal CDP client, same shape as test-ui-keys.js ---- */
function connect(cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      var tabs = [];
      try { tabs = JSON.parse(body); } catch (e) {}
      var page = tabs.filter(function (t) { return t.type === 'page'; })[0];
      if (!page) return cb(new Error('no page in the headless browser'));
      var id = 0, waiting = {}, sock = null;
      sock = wsConnect(page.webSocketDebuggerUrl, function (raw) {
        var msg = JSON.parse(raw);
        if (msg.id && waiting[msg.id]) { waiting[msg.id](msg); delete waiting[msg.id]; }
      }, function () {
        cb(null, {
          send: function (method, params, done) {
            var n = ++id;
            waiting[n] = done || function () {};
            sock.send({ id: n, method: method, params: params || {} });
          },
          close: function () { try { sock.close(); } catch (e) {} }
        });
      });
    });
  }).on('error', cb);
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

var client;

function evalJs(expr, cb) {
  client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    cb(r && typeof r.value !== 'undefined' ? r.value : (r && r.description ? r.description : undefined));
  });
}

var KEYMAP = {
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ok: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
};

function key(name, cb) {
  var k = KEYMAP[name] || KEYMAP.ok;
  client.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: k.key, code: k.code,
    windowsVirtualKeyCode: k.windowsVirtualKeyCode, nativeVirtualKeyCode: k.windowsVirtualKeyCode
  }, function () {
    client.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: k.key, code: k.code,
      windowsVirtualKeyCode: k.windowsVirtualKeyCode, nativeVirtualKeyCode: k.windowsVirtualKeyCode
    }, function () { setTimeout(cb, 140); });
  });
}

function zone(cb) {
  evalJs('(function(){try{var d=window.CleanFrameDebug;var s=d.state()||{};var l=(d.look?d.look():{})||{};return JSON.stringify({view:s.view||null,zone:s.zone||null,layout:l.layout||null,apps:l.apps||null});}catch(e){return JSON.stringify({error:String(e)});}})()', function (v) {
    var out = {};
    try { out = JSON.parse(v); } catch (e) {}
    cb(out);
  });
}

function seed(cb) {
  /* A home screen with two apps, and a value strip that actually gets chips: the
   * strip is built from the server configuration plus the values read from Home
   * Assistant, so the test asks the debug interface for both. */
  var cfg = {
    look: { bg: 'photo', layout: 'dock', apps: 'both' },
    home: ['netflix', 'youtube.leanback.v4'],
    integrations: { ha: { url: '', entities: [
      { id: 'light.wohnzimmerlicht', shown: true },
      { id: 'switch.fernseher_schalter', shown: true }
    ] } }
  };
  evalJs('(function(){try{localStorage.setItem("cleanframe.home.v1", ' + JSON.stringify(JSON.stringify(cfg)) + ');return "seeded";}catch(e){return "error: "+e.message;}})()', function (r) {
    cb(r);
  });
}

function run() {
  evalJs('document.readyState', function (state) {
    seed(function (seeded) {
      check('state seeded', seeded === 'seeded', String(seeded));
      client.send('Page.reload', {}, function () {});
      setTimeout(function () {
        evalJs('typeof window.CleanFrameDebug', function (t) {
          check('launcher loaded (debug interface present)', t === 'object', String(t));
          evalJs('JSON.stringify(window.CleanFrameDebug.state().home)', function (homeJson) {
            var home = [];
            try { home = JSON.parse(homeJson); } catch (e) {}
            check('home screen has apps after the reload', home.length > 0, home.length + ' apps');
            zone(function (z) {
              check('layout is the dock', z.layout === 'dock', String(z.layout));
              check('the tiles have the focus', z.zone === 'apps', String(z.zone));
              tileSize(function (size) {
                /* 0.6.4: tile 288x216, mark 232x124, label row at 140. The mark
                 * may grow further, the label row has to stay clear of it. */
                check('tile is 288 wide', size.tw === 288, JSON.stringify(size));
                check('tile is 216 high', size.th === 216, JSON.stringify(size));
                check('the mark grew beyond the old 200x118', size.mw >= 210 && size.mh >= 108,
                      size.mw + 'x' + size.mh);
                check('the label sits at y=140', Math.abs(size.labelTop - 140) <= 2, String(size.labelTop));
                check('mark and label do not overlap', size.mh + 6 <= size.labelTop + 2,
                      'mark ends ' + (size.mh + 6) + ', label starts ' + size.labelTop);
                downIntoStrip();
              });
            });
          });
        });
      }, 2200);
    });
  });
}

function tileSize(cb) {
  evalJs('(function(){' +
    'var tile=document.querySelector(".dock .tile");' +
    'if(!tile) return JSON.stringify({error:"no tile"});' +
    'var mark=tile.querySelector(".mark")||tile.querySelector("span.mark");' +
    'var label=tile.querySelector(".label");' +
    'var mr=mark?mark.getBoundingClientRect():null, lr=label?label.getBoundingClientRect():null, tr=tile.getBoundingClientRect();' +
    'var scale=document.getElementById("stage").getBoundingClientRect().width/1920||1;' +
    'return {tw:Math.round(tr.width/scale),th:Math.round(tr.height/scale),' +
    'mw:mr?Math.round(mr.width/scale):0,mh:mr?Math.round(mr.height/scale):0,' +
    'labelTop:lr?Math.round((lr.top-tr.top)/scale):-1};})()', function (size) {
    if (typeof size === 'string') { try { size = JSON.parse(size); } catch (e) { size = {}; } }
    cb(size || {});
  });
}

function downIntoStrip() {
  /* Gemessen: die Werteleiste liegt mit ihrem unteren Rand ueber dem Dock
   * (strip bottom 636, dock top 676), die Werkzeuge darunter. Also: "up" in die
   * Leiste, "down" zu den Werkzeugen, und aus den Werkzeugen zurueck mit "up".
   * Der Test hatte die verdrehte Richtung festgeschrieben. */
  evalJs('(function(){return document.querySelectorAll("#haStrip .ha-chip").length;})()', function (chips) {
    var n = parseInt(chips, 10) || 0;
    key('down', function () {
      zone(function (z) {
        check('down from the tiles reaches the utilities below', z.zone === 'util', String(z.zone));
        key('up', function () {
          zone(function (z2) {
            check('up from the utilities returns to the tiles', z2.zone === 'apps', String(z2.zone));
            if (n > 0) {
              key('up', function () {
                zone(function (z3) {
                  check('up from the tiles enters the value strip above', z3.zone === 'ha', String(z3.zone));
                  key('down', function () {
                    zone(function (z4) {
                      check('down from the strip returns to the tiles', z4.zone === 'apps', String(z4.zone));
                      finish();
                    });
                  });
                });
              });
            } else finish();
          });
        });
      });
    });
  });
}

function finish() {
  var ok = results.filter(function (r) { return r.ok; }).length;
  console.log('\n' + ok + '/' + results.length + ' checks passed');
  console.log('RESULT ' + ok + '/' + results.length);
  if (client) client.close();
  process.exit(ok === results.length ? 0 : 1);
}

connect(function (err, c) {
  if (err) { console.log('FAIL: ' + err.message); process.exit(1); }
  client = c;
  client.send('Page.enable', {}, function () {
    client.send('Page.navigate', { url: PAGE }, function () {
      setTimeout(run, 1500);
    });
  });
});
