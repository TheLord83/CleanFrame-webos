/*
 * Measure the start page as the television draws it: dock tile, mark inside it,
 * label, and the strip of Home Assistant chips above the dock. Numbers only, so the
 * answer does not depend on how a screenshot is interpreted.
 * 
 * Run after starting the test hub:
 *   node tools/measure-home.js --port 9333 --config http://127.0.0.1:8499/api/config
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');

function arg(name, fallback) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
var PORT = parseInt(arg('port', '9333'), 10);
var CONFIG = arg('config', 'http://127.0.0.1:8499/api/config');
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
function key(name, cb) {
  var map = {
    up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
    ok: { key: 'Enter', code: 'Enter', vk: 13 }, back: { key: 'Escape', code: 'Escape', vk: 27 }
  }[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: map.key, code: map.code, windowsVirtualKeyCode: map.vk }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: map.key, code: map.code, windowsVirtualKeyCode: map.vk }, function () {
      setTimeout(cb || function () {}, 260);
    });
  });
}

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
        send('Page.enable', {}, function () {
          send('Page.navigate', { url: PAGE }, function () { setTimeout(boot, 2400); });
        });
      });
    });
  });
});

function boot() {
  js('(function(){try{localStorage.removeItem("cleanframe.home.v1");localStorage.removeItem("cleanframe.shore.v1");}catch(e){}return 1;})()', function () {
    send('Page.reload', {}, function () {});
    setTimeout(afterReload, 4200);
  });
}

function afterReload() {
  js('(function(){try{window.CleanFrameDebug.focusStage();}catch(e){}return 1;})()', function () {
    setTimeout(measureAll, 2200);
  });
}

function measureAll() {
  js([
    '(function(){',
    'function box(el){if(!el)return null;var b=el.getBoundingClientRect();',
    'return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height),cx:Math.round(b.left+b.width/2)};}',
    'var tiles=document.querySelectorAll("#dock .tile"), t=tiles[0];',
    'var mark=t?t.querySelector(".mark"):null, label=t?t.querySelector(".label"):null;',
    'var strip=document.getElementById("haStrip");',
    'var chips=[].slice.call(document.querySelectorAll("#haStrip .ha-chip"));',
    'return JSON.stringify({',
    ' tile:box(t), mark:box(mark), label:box(label), tiles:tiles.length,',
    ' tileCenter:t?Math.round(t.getBoundingClientRect().left+t.getBoundingClientRect().width/2):null,',
    'strip:box(strip), stripHidden:strip?strip.hidden:null,',
    'chips:chips.map(function(c){var b=box(c);return {text:c.textContent,name:(c.querySelector(".ha-chip-name")||{}).textContent,cls:c.className,cx:b.cx,l:b.l,r:b.r,t:b.t};}),',
    'zone:(window.CleanFrameDebug.state()||{}).zone, view:(window.CleanFrameDebug.state()||{}).view});',
    '})()'
  ].join(''), function (raw) {
    var o;
    try { o = JSON.parse(raw); } catch (e) { console.log('parse: ' + raw); process.exit(1); }
    console.log('tiles: ' + o.tiles + '  zone: ' + o.zone + '  strip hidden: ' + o.stripHidden);
    if (o.tile) {
      console.log('tile   w=' + o.tile.w + ' h=' + o.tile.h + '  center=' + o.tileCenter + '  left=' + o.tile.l + ' right=' + o.tile.r);
    }
    if (o.mark && o.tile) {
      console.log('mark   w=' + o.mark.w + ' h=' + o.mark.h + '  center=' + o.mark.cx +
        '  offset from tile center: ' + (o.mark.cx - o.tileCenter));
    }
    if (o.label && o.tile) {
      console.log('label  w=' + o.label.w + '  center=' + o.label.cx +
        '  offset from tile center: ' + (o.label.cx - o.tileCenter));
    }
    if (o.strip) console.log('strip  top=' + o.strip.t + ' bottom=' + o.strip.b + ' h=' + o.strip.h);
    if (o.chips) {
      o.chips.forEach(function (c, i) {
        console.log('chip ' + i + ' [' + c.cls + '] "' + c.text + '" cx=' + c.cx + ' l=' + c.l + ' r=' + c.r);
      });
      var sw = o.chips.filter(function (c) { return c.cls.indexOf('is-switch') >= 0; });
      console.log('switchable chips: ' + sw.length + ' of ' + o.chips.length);
    }
    walk(o.chips ? o.chips.filter(function (c) { return c.cls.indexOf('is-switch') >= 0; }).length : 0);
  });
}

/* Edge cases: enter the strip from the far right and far left, walk to the end,
 * and come back down onto the tile underneath. */
function walk() {
  var steps = [];
  function step(fn) { steps.push(fn); }
  function run(i) { if (i >= steps.length) { client.close(); process.exit(0); } steps[i](function () { run(i + 1); }); }

  function report(label, fn) {
    step(function (done) {
      js('(function(){var f=document.querySelector("#haStrip .ha-chip.is-focus");var st=window.CleanFrameDebug.state();return JSON.stringify({focus:f?f.textContent:"none",zone:st.zone});})()', function (r) {
        console.log(label + ': ' + r); fn(r, done);
      });
    });
  }
  function reset(done) {
    // zurueck auf zone apps, Auswahl auf erste Kachel
    js('(function(){try{window.CleanFrameDebug.state();}catch(e){}return 1;})()', function () {
      key('down', function () { done(); });
    });
  }

  // 1. alle Kacheln nach rechts, dann nach oben
  step(function (done) { key('right', function () { key('right', function () { key('right', function () { key('right', function () { done(); }); }); }); }); });
  report('rechts aussen', function (r, done) { key('up', function () { done(); }); });
  report('  -> oben', function (r, done) { key('right', function () { done(); }); });
  report('  -> rechts (soll bleiben)', function (r, done) { key('down', function () { done(); }); });
  report('  -> unten (soll rechte Kachel)', function (r, done) { done(); });

  // 2. ganz nach links, dann nach oben
  step(function (done) { key('left', function () { key('left', function () { key('left', function () { key('left', function () { done(); }); }); }); }); });
  report('links aussen', function (r, done) { key('up', function () { done(); }); });
  report('  -> oben', function (r, done) { key('left', function () { done(); }); });
  report('  -> links (soll bleiben)', function (r, done) { key('down', function () { done(); }); });
  report('  -> unten (soll linke Kachel)', function (r, done) { done(); });

  run(0);
}
