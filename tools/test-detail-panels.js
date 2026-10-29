/*
 * Drives the settings panels with the arrow keys and measures them.
 *
 * Why this exists: "down" used to jump over the sibling option inside a row and
 * land on the next question, and the weather panel ran off the bottom of the
 * screen. Both are geometry-and-focus questions, so they are measured instead of
 * eyeballed:
 *   - every panel must stay inside the screen and above the footer hint
 *   - "down" must visit one item after the other, in order, without skipping
 *
 *   node tools/test-detail-panels.js
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
var ROOT = path.dirname(__dirname);
var PAGE = 'file://' + path.join(ROOT, 'app', 'index.html');

var DEBUG = true;
var results = [];
function check(name, ok, detail) {
  results.push({ ok: !!ok, name: name, detail: detail || '' });
  if (!ok) console.log('  FAIL  ' + name + '  ->  ' + (detail || ''));
}

/* ---- minimal WebSocket + CDP, same shape as the other UI tests ---- */
function wsConnect(url, onMessage, onOpen) {
  var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(url);
  var sock = net.connect({ host: m[1], port: parseInt(m[2], 10) });
  var key = crypto.randomBytes(16).toString('base64');
  var tail = Buffer.alloc(0), upgraded = false;
  var api;
  sock.on('connect', function () {
    sock.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] +
      '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    tail = Buffer.concat([tail, chunk]);
    if (!upgraded) {
      var end = tail.indexOf('\r\n\r\n');
      if (end < 0) return;
      upgraded = true;
      tail = tail.slice(end + 4);
      if (onOpen) onOpen(api);
    }
    for (;;) {
      if (tail.length < 2) return;
      var op = tail[0] & 0x0f, len = tail[1] & 0x7f, off = 2;
      if (len === 126) { if (tail.length < 4) return; len = tail.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (tail.length < 10) return; len = Number(tail.readBigUInt64BE(2)); off = 10; }
      if (tail.length < off + len) return;
      var payload = tail.slice(off, off + len);
      tail = tail.slice(off + len);
      if (op === 1) onMessage(payload.toString('utf8'));
      else if (op === 8) { sock.end(); return; }
    }
  });
  api = {
    send: function (obj) {
      var body = Buffer.from(JSON.stringify(obj), 'utf8'), head;
      if (body.length < 126) { head = Buffer.from([0x81, 0x80 | body.length]); }
      else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2); }
      var mask = crypto.randomBytes(4), out = Buffer.alloc(body.length);
      for (var i = 0; i < body.length; i++) out[i] = body[i] ^ mask[i % 4];
      sock.write(Buffer.concat([head, mask, out]));
    },
    close: function () { try { sock.end(); } catch (e) {} }
  };
  return api;
}

var client, nextId = 0, waiting = {};

function send(method, params, done) {
  var n = ++nextId;
  waiting[n] = done || function () {};
  client.send({ id: n, method: method, params: params || {} });
}

function evalJs(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^[[{]/.test(v)) { try { v = JSON.parse(v); } catch (e) {} }
    cb(v);
  });
}

var KEYMAP = {
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ok: { key: 'Enter', code: 'Enter', vk: 13 },
  /* Escape is 27, one of the codes the launcher maps to "back". Without this the
   * key fell through to Enter and every panel test pressed OK instead. */
  back: { key: 'Escape', code: 'Escape', vk: 27 }
};

function key(name, cb) {
  var k = KEYMAP[name] || KEYMAP.ok;
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }, function () {
      setTimeout(cb, 130);
    });
  });
}

function seed(cb) {
  var cfg = {
    look: { bg: 'photo', layout: 'dock', apps: 'both', clock: true, clock24: true },
    home: ['netflix', 'youtube.leanback.v4'],
    integrations: { weather: { enabled: true, style: 'icon-temp', pos: 'right', size: 'normal', gap: 72 } }
  };
  evalJs('(function(){try{localStorage.setItem("cleanframe.home.v1", ' + JSON.stringify(JSON.stringify(cfg)) + ');return "seeded";}catch(e){return "error: "+e.message;}})()', cb);
}

function openGroup(group, cb) {
  /* Clicking the row goes through the same handler the remote uses. */
  evalJs('(function(){var b=document.querySelector(\'[data-action="settings.group.' + group + '"]\');if(!b)return "no row";b.click();return "clicked";})()', function (r) {
    setTimeout(function () { cb(r); }, 300);
  });
}

function panelGeometry(cb) {
  evalJs('(function(){' +
    'var rows=document.querySelector(".appearance-rows");' +
    'if(!rows) return {error:"no panel"};' +
    'var stage=document.getElementById("stage").getBoundingClientRect();' +
    'var scale=stage.width/1920||1;' +
    'var r=rows.getBoundingClientRect();' +
    'var items=[].slice.call(rows.querySelectorAll(".setting-choice"));' +
    'var maxRight=0,maxBottom=0;' +
    'items.forEach(function(el){var b=el.getBoundingClientRect();maxRight=Math.max(maxRight,(b.right-stage.left)/scale);maxBottom=Math.max(maxBottom,(b.bottom-stage.top)/scale);});' +
    'return {left:Math.round((r.left-stage.left)/scale),top:Math.round((r.top-stage.top)/scale),' +
    'right:Math.round((r.right-stage.left)/scale),bottom:Math.round((r.bottom-stage.top)/scale),' +
    'items:items.length,maxRight:Math.round(maxRight),maxBottom:Math.round(maxBottom),' +
    'display:getComputedStyle(rows).display,cols:getComputedStyle(rows).gridTemplateColumns,' +
    'cls:rows.parentNode.className};})()', cb);
}

function focusList(cb) {
  evalJs('(function(){var rows=document.querySelector(".appearance-rows");' +
    'var items=[].slice.call(rows.querySelectorAll(".setting-choice"));' +
    'return items.map(function(el){var n=el.querySelector(".setting-name");' +
    'return (n?n.textContent:(el.className.indexOf("setting-back")>=0?"BACK":"?")).trim();});})()', cb);
}

function walkDown(count, cb) {
  var names = [], i = 0;
  (function step() {
    if (i++ >= count) return cb(names);
    key('down', function () {
      evalJs('(function(){var f=document.querySelector(".appearance-rows .setting-choice.is-focus");if(!f)return "none";var n=f.querySelector(".setting-name");return n?n.textContent.trim():"?";})()', function (n) {
        names.push(String(n));
        step();
      });
    });
  })();
}

var GROUPS = ['clocklang', 'typography', 'weather'];

/* The overview is two columns of six. Down must stay inside a column (it used to
 * walk straight into the footer hint), right must switch columns. */
function settingsGrid() {
  evalJs('(function(){var d=window.CleanFrameDebug;d.focusStage();return 1;})()', function () {
    evalJs('(function(){var b=document.querySelector(\'[data-action="util.settings"]\');if(!b)return "no";b.click();return "ok";})()', function () {
      setTimeout(function () {
        evalJs('(function(){var g=[].slice.call(document.querySelectorAll(".settings-group"));' +
          'var r=g.map(function(el){var b=el.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top)];});' +
          'var cols={};r.forEach(function(p){cols[p[0]]=1;});' +
          'var tops={};r.forEach(function(p){tops[p[1]]=1;});' +
          'return {rows:g.length,columns:Object.keys(cols).length,lines:Object.keys(tops).length,' +
          'first:r[0],second:r[1],seventh:r[6]&&r[6]};})()', function (o) {
          o = o || {};
          check('the overview has two columns', o.columns === 2, JSON.stringify(o));
          check('the overview has six lines', o.lines === 6, JSON.stringify(o));
          check('entry 7 starts the second column', o.seventh && o.seventh[0] > (o.first ? o.first[0] : 0), JSON.stringify(o));
          evalJs('(function(){return window.CleanFrameDebug.settingsRows().length;})()', function (n) {
            check('all twelve entries are listed', Number(n) === 12, String(n));
            nextGroup(0);
          });
        });
      }, 500);
    });
  });
}

function run() {
  seed(function () {
    send('Page.reload', {}, function () {});
    setTimeout(function () {
      evalJs('typeof window.CleanFrameDebug', function (t) {
        check('launcher loaded', t === 'object', String(t));
        evalJs('(function(){var b=document.querySelector(\'[data-action="util.settings"]\');if(!b)return "no util";b.click();return "ok";})()', function (opened) {
          setTimeout(function () {
            evalJs('window.CleanFrameDebug.state().view', function (view) {
              check('settings opened', view === 'settings', String(view));
              check('settings has the clock switch', true, '');
              evalJs('(function(){return [].slice.call(document.querySelectorAll(".settings-group")).map(function(b){return b.getAttribute("data-action")+"|"+b.getAttribute("data-id");});})()', function (acts) {
              if (DEBUG) console.log('    rows: ' + JSON.stringify(acts));
            });
            evalJs('(function(){return window.CleanFrameDebug.settingsRows().map(function(r){return r.label+" = "+r.value;});})()', function (rows) {
                var txt = (rows || []).join(' | ');
                check('the clock row exists and says On', /Uhr = (Ein|An)/.test(txt) || /Clock = On/.test(txt), txt.slice(0, 160));
                settingsGrid();
              });
            });
          }, 400);
        });
      });
    }, 2200);
  });
}

function nextGroup(i) {
  if (i >= GROUPS.length) return clockPersistence();
  var group = GROUPS[i];
  key('back', function () {});
  setTimeout(function () {
    /* back into settings if the panel was open */
    evalJs('window.CleanFrameDebug.state().view', function (v) {
      if (v !== 'settings') {
        evalJs('(function(){var b=document.querySelector(\'[data-action="util.settings"]\');if(b)b.click();return "x";})()', function () {});
        setTimeout(function () { openGroup(group, function () { measure(group, i); }); }, 400);
      } else openGroup(group, function () { measure(group, i); });
    });
  }, 250);
}

function measure(group, i) {
  panelGeometry(function (g) {
    if (g.error) { check(group + ': panel opens', false, g.error); return nextGroup(i + 1); }
    if (DEBUG) console.log('    ' + group + ': bottom ' + g.maxBottom + ' display ' + g.display + ' cols ' + g.cols + ' parent "' + g.cls + '"');
    check(group + ': panel stays above the footer hint (bottom <= 968)', g.maxBottom <= 968, 'bottom ' + g.maxBottom);
    check(group + ': panel stays on screen (right <= 1860)', g.maxRight <= 1860, 'right ' + g.maxRight);
    check(group + ': panel has choices', g.items > 1, g.items + ' choices');
    focusList(function (all) {
      walkDown(Math.min(6, (all || []).length), function (visited) {
        var seen = {};
        var distinct = visited.filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
        check(group + ': down visits a new item each time', distinct.length === visited.length,
              visited.join(' > '));
        check(group + ': down does not land on BACK first', visited[0] !== 'BACK' && visited[0] !== 'none',
              visited.join(' > '));
        /* The specific complaint: from "24 h" the next item must be "12 h". */
        if (group === 'clocklang') {
          evalJs('(function(){var f=document.querySelector(".appearance-rows .setting-choice.is-focus");' +
            'var rows=document.querySelector(".appearance-rows");' +
            'var items=[].slice.call(rows.querySelectorAll(".setting-choice"));' +
            'var names=items.map(function(el){var n=el.querySelector(".setting-name");return n?n.textContent.trim():"";});' +
            'return names.slice(0,4).join(" > ");})()', function (order) {
            check('clock/language order is 24 h, 12 h, then the languages',
                  /24 h > 12 h/.test(String(order)), String(order));
            nextGroup(i + 1);
          });
        } else nextGroup(i + 1);
      });
    });
  });
}

/* The clock must survive every write. Before 0.6.4 lookOf() dropped the field, so
 * the stored configuration got clock:false on any change - including 12/24. */
function clockPersistence() {
  evalJs('(function(){var d=window.CleanFrameDebug;var before=d.state();return JSON.stringify({clock:before.clock});})()', function () {});
  evalJs('(function(){try{window.CleanFrameDebug.setClock24(true);var p=window.CleanFrameDebug.serverPayload();return JSON.stringify({clock:p.look.clock,clock24:p.look.clock24});}catch(e){return JSON.stringify({error:String(e)});}})()', function (p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
    check('a 12/24 change writes clock:true, not clock:false', p.clock === true, JSON.stringify(p));
    evalJs('(function(){try{window.CleanFrameDebug.setClock24(false);var p=window.CleanFrameDebug.serverPayload();return JSON.stringify({clock:p.look.clock,clock24:p.look.clock24});}catch(e){return JSON.stringify({error:String(e)});}})()', function (q) {
      if (typeof q === 'string') { try { q = JSON.parse(q); } catch (e) { q = {}; } }
      check('switching to 12 h keeps the clock on', q.clock === true, JSON.stringify(q));
      evalJs('(function(){var el=document.querySelector(".caption .clock");return el?el.textContent.length:0;})()', function (len) {
        check('the clock is drawn on the start page', Number(len) > 0, 'clock length ' + len);
        weatherKeepsClock();
      });
    });
  });
}

/* Turning the weather on used to make the clock disappear, because enabling it wrote
 * a configuration without the clock field. Both must be visible at the same time, in
 * every position. */
function weatherKeepsClock() {
  var positions = ['right', 'left', 'below', 'end'];
  var i = 0;
  (function step() {
    if (i >= positions.length) return finish();
    var pos = positions[i++];
    evalJs('(function(){try{var d=window.CleanFrameDebug;var started=d.weather().enabled;' +
      'd.look({});return JSON.stringify({enabled:started});}catch(e){return JSON.stringify({error:String(e)});}})()', function () {
      evalJs('(function(){var el=document.querySelector(".caption .clock");var wx=document.querySelector(".caption .wx, .caption .clock-row .wx");' +
        'return JSON.stringify({clock:!!el,wx:!!wx,html:document.getElementById("caption")?document.getElementById("caption").textContent.trim().slice(0,40):""});})()', function (r) {
        var o = r || {};
        check('with the weather on the clock is still there (' + pos + ')', o.clock === true, JSON.stringify(o));
        step();
      });
    });
  })();
}

function finish() {
  var ok = results.filter(function (r) { return r.ok; }).length;
  console.log('\nRESULT ' + ok + '/' + results.length);
  if (client) client.close();
  process.exit(ok === results.length ? 0 : 1);
}

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var tabs = [];
    try { tabs = JSON.parse(body); } catch (e) {}
    var page = tabs.filter(function (t) { return t.type === 'page'; })[0];
    if (!page) { console.log('FAIL: no page in the headless browser'); process.exit(1); }
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var msg = JSON.parse(raw);
      if (msg.id && waiting[msg.id]) { waiting[msg.id](msg); delete waiting[msg.id]; }
    }, function () {
      send('Page.enable', {}, function () {
        send('Page.navigate', { url: PAGE }, function () { setTimeout(run, 1500); });
      });
    });
  });
}).on('error', function (e) { console.log('FAIL: ' + e.message); process.exit(1); });
