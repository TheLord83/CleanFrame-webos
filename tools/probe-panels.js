/* One-off probe: open a settings group by clicking its row and report what the
 * panel contains. Used while fixing the panels, not part of check-all. */
'use strict';
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var ROOT = '/root/cleanframe-webos';
var PAGE = 'file://' + path.join(ROOT, 'app', 'index.html');
var GROUPS = ['clocklang', 'typography', 'weather'];

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
      var end = tail.indexOf('\r\n\r\n');
      if (end < 0) return;
      up = true; tail = tail.slice(end + 4);
      if (onOpen) onOpen(api);
    }
    for (;;) {
      if (tail.length < 2) return;
      var op = tail[0] & 0x0f, len = tail[1] & 0x7f, off = 2;
      if (len === 126) { if (tail.length < 4) return; len = tail.readUInt16BE(2); off = 4; }
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
    close: function () { try { sock.end(); } catch (e) {} }
  };
  return api;
}

var client, id = 0, waiting = {};
function send(m, p, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: m, params: p || {} }); }
function js(e, cb) {
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^[[{]/.test(v)) { try { v = JSON.parse(v); } catch (x) {} }
    cb(v);
  });
}

http.get({ host: '127.0.0.1', port: 9333, path: '/json/list' }, function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Page.enable', {}, function () {
        send('Page.navigate', { url: PAGE }, function () { setTimeout(boot, 1800); });
      });
    });
  });
});

function boot() {
  console.log('view:', JSON.stringify(js('window.CleanFrameDebug ? window.CleanFrameDebug.state().view : "none"', function (v) {
    js('(function(){var b=document.querySelector(\'[data-action="util.settings"]\');if(!b)return "no util button";b.click();return "clicked settings";})()', function (r) {
      console.log('open settings:', r);
      setTimeout(function () {
        js('window.CleanFrameDebug.state().view', function (v2) {
          console.log('view now:', v2);
          probeGroup(0);
        });
      }, 500);
    });
  })));
}

function probeGroup(i) {
  if (i >= GROUPS.length) { client.close(); process.exit(0); }
  var g = GROUPS[i];
  js('(function(){var b=document.querySelector(\'[data-action="settings.group.' + g + '"]\');if(!b)return "no row";b.click();return "clicked ' + g + '";})()', function (r) {
    setTimeout(function () {
      js('(function(){var s=window.CleanFrameDebug.state();var rows=document.querySelector(".appearance-rows");' +
        'var names=rows?[].slice.call(rows.querySelectorAll(".setting-choice")).map(function(el){var n=el.querySelector(".setting-name");return n?n.textContent.trim():"";}):[];' +
        'var secs=rows?[].slice.call(rows.querySelectorAll(".setting-section")).map(function(el){var l=el.querySelector(".setting-label");return l?l.textContent.trim():"";}):[];' +
        'var r=rows?rows.getBoundingClientRect():null;var st=document.getElementById("stage").getBoundingClientRect();var sc=st.width/1920||1;' +
        'return {view:s.view,group:s.group,action:s.action,names:names,secs:secs,' +
        'bottom:r?Math.round((r.bottom-st.top)/sc):-1,right:r?Math.round((r.right-st.left)/sc):-1,scrollH:rows?rows.scrollHeight:0,h:rows?Math.round(r.height/sc):0,' +
        'display:rows?getComputedStyle(rows).display:null,cols:rows?getComputedStyle(rows).gridTemplateColumns:null,' +
        'choiceH:rows&&rows.querySelector(".setting-choice")?Math.round(rows.querySelector(".setting-choice").getBoundingClientRect().height/sc):0,' +
        'secsH:rows?[].slice.call(rows.children).map(function(el){return Math.round(el.getBoundingClientRect().height/sc);}):[]};})()', function (o) {
        console.log('\n=== ' + g + ' ===\n' + JSON.stringify(o, null, 1));
        js('(function(){var ev=new KeyboardEvent("keydown",{key:"Escape",bubbles:true});document.dispatchEvent(ev);return 1;})()', function () {
          setTimeout(function () {
            js('(function(){if(window.CleanFrameDebug.state().view!=="settings"){var b=document.querySelector(\'[data-action="util.settings"]\');if(b)b.click();}return window.CleanFrameDebug.state().view;})()', function () {
              setTimeout(function () { probeGroup(i + 1); }, 400);
            });
          }, 250);
        });
      }, 400);
    });
  });
}
