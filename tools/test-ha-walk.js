/* Die Werteleiste muss mit den Pfeiltasten vollstaendig begehbar sein - auch ueber
 * reine Anzeigen (Fenster, Temperatur). OK auf einer Anzeige darf nichts schalten.
 *
 *   node tools/test-ha-walk.js --port 9333
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
var PORT = parseInt(arg('port', '9333'), 10);
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
    if (!up) {
      var e = tail.indexOf('\r\n\r\n');
      if (e < 0) return;
      up = true; tail = tail.slice(e + 4);
      if (onOpen) onOpen(api);
    }
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
  api = {
    send: function (o) {
      var b = Buffer.from(JSON.stringify(o), 'utf8'), h;
      if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(b.length, 2); }
      var mk = crypto.randomBytes(4), out = Buffer.alloc(b.length);
      for (var i = 0; i < b.length; i++) out[i] = b[i] ^ mk[i % 4];
      sock.write(Buffer.concat([h, mk, out]));
    },
    close: function () { try { sock.end(); } catch (x) {} }
  };
  return api;
}

var client, id = 0, waiting = {};
function send(method, params, cb) {
  var n = ++id; waiting[n] = cb || function () {};
  client.send({ id: n, method: method, params: params || {} });
}
function js(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined);
  });
}
var KEYS = {
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ok: { key: 'Enter', code: 'Enter', vk: 13 }, back: { key: 'Escape', code: 'Escape', vk: 27 }
};
function key(name, cb) {
  var m = KEYS[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk }, function () {
      setTimeout(cb || function () {}, 240);
    });
  });
}

var results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok });
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok || !detail ? '' : '  ->  ' + detail));
}
function finish() {
  var ok = results.filter(function (r) { return r.ok; }).length;
  console.log('RESULT ' + ok + '/' + results.length);
  client.close();
  process.exit(ok === results.length ? 0 : 1);
}

var FOCUS = '(function(){var f=document.querySelector("#haStrip .ha-chip.is-focus");' +
  'var st=window.CleanFrameDebug.state();' +
  'var all=document.querySelectorAll("#haStrip .ha-chip").length;' +
  'return JSON.stringify({on:!!f,cls:f?f.className:"",text:f?f.textContent:"",zone:st.zone,all:all});})()';

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    if (!page) { console.log('no page on port ' + PORT); process.exit(1); }
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, function () {
        send('Network.enable', {}, function () { send('Network.setCacheDisabled', { cacheDisabled: true }, function () { send('Page.enable', {}, function () {
          send('Page.navigate', { url: PAGE }, function () { setTimeout(start, 5000); }); }); });
        });
      });
    });
  });
});

function start() {
  js('(function(){try{window.CleanFrameDebug.focusStage();}catch(e){}return document.querySelectorAll("#haStrip .ha-chip").length;})()', function (n) {
    var count = parseInt(n, 10) || 0;
    check('the strip has chips', count > 0, 'chips: ' + count);
    /* Erst auf die rechte Kachel: dann steht der Fokus auf dem rechten Chip und
     * links/rechts hat in beide Richtungen Platz. (Der erste Lauf startete links,
     * "left" konnte dort korrekt nichts tun - der Test war falsch, nicht der Code.) */
    key('right', function () {
      key('right', function () {
        key('right', function () {
          key('right', function () {
            key('right', function () {
              key('up', function () {
                js(FOCUS, function (raw) {
                  var f = JSON.parse(raw);
                  check('up from the tiles focuses a chip', f.zone === 'ha' && f.on, raw);
                  var seen = [f.text];
                  walk(0, count, seen);
                });
              });
            });
          });
        });
      });
    });
  });
}

/* Einmal nach links bis zum Anschlag, jeden Zwischenschritt merken. */
function walk(step, count, seen) {
  if (step >= count + 1) {
    check('every chip can be reached', seen.length >= count, 'reached ' + seen.length + ' of ' + count);
    var uniq = seen.filter(function (v, i) { return seen.indexOf(v) === i; });
    check('all chips are distinct', uniq.length >= count, uniq.join(' | '));
    return backToTiles();
  }
  key('left', function () {
    js(FOCUS, function (raw) {
      var f = JSON.parse(raw);
      if (f.on && seen.indexOf(f.text) < 0) seen.push(f.text);
      walk(step + 1, count, seen);
    });
  });
}

/* Auf einer Anzeige OK druecken: der Zustand darf sich nicht aendern. */
function backToTiles() {
  key('right', function () {
    js(FOCUS, function (raw) {
      var before = JSON.parse(raw);
      key('ok', function () {
        js(FOCUS, function (after) {
          var a = JSON.parse(after);
          if (String(before.cls).indexOf('is-static') >= 0) {
            check('OK on a reading changes nothing', a.text === before.text && a.zone === 'ha',
                  before.text + ' -> ' + a.text);
          } else {
            check('OK on a switchable chip stays in the strip', a.zone === 'ha', after);
          }
          key('down', function () {
            js('(function(){return JSON.stringify({zone:window.CleanFrameDebug.state().zone});})()', function (z) {
              check('down leaves the strip for the utilities', /"zone":"util"/.test(String(z)), String(z));
              key('back', function () {
                js('(function(){return JSON.stringify({zone:window.CleanFrameDebug.state().zone});})()', function (z2) {
                  check('back returns to the tiles', /"zone":"apps"/.test(String(z2)), String(z2));
                  finish();
                });
              });
            });
          });
        });
      });
    });
  });
}
