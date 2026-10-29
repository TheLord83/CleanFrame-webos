/* Measures how tall the weather/typography panels get at different row heights,
 * so the fix is a measurement instead of a guess. One-off tool. */
'use strict';
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.join('/root/cleanframe-webos', 'app', 'index.html');

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
      if (tail.length < off + len) return;
      var p = tail.slice(off, off + len); tail = tail.slice(off + len);
      if (op === 1) onMessage(p.toString('utf8')); else if (op === 8) { sock.end(); return; }
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
function send(m, p, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: m, params: p || {} }); }
function js(e, cb) {
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^[[{]/.test(v)) { try { v = JSON.parse(v); } catch (x) {} }
    cb(v);
  });
}
function key(code, cb) {
  var map = { 40: ['ArrowDown', 40], 38: ['ArrowUp', 38], 27: ['Escape', 27], 13: ['Enter', 13] };
  var k = map[code];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k[0], code: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: k[0], code: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] }, function () { setTimeout(cb, 120); });
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
      send('Page.enable', {}, function () { send('Page.navigate', { url: PAGE }, function () { setTimeout(boot, 1800); }); });
    });
  });
});

function boot() {
  js('(function(){localStorage.setItem("cleanframe.home.v1",JSON.stringify({look:{bg:"photo",layout:"dock",apps:"both",clock:true},home:["netflix","youtube.leanback.v4","com.blackpearl.cleanframe"],integrations:{weather:{enabled:true,style:"icon-temp",pos:"right",size:"normal",gap:72}}}));return 1;})()', function () {
    send('Page.reload', {}, function () {});
    setTimeout(function () { measureTiles('both', function () { measureTiles('icons', function () { measureGrid(function () { client.close(); process.exit(0); }); }); }); }, 2200);
  });
}

function measureGrid(cb) {
  js('(function(){var b=document.querySelector(\'[data-action="util.apps"]\');if(!b)return "no util";b.click();return "ok";})()', function () {
    setTimeout(function () {
      js('(function(){var st=document.getElementById("stage").getBoundingClientRect();var sc=st.width/1920||1;' +
        'var cells=[].slice.call(document.querySelectorAll(".gt"));' +
        'if(!cells.length) return {view:(window.CleanFrameDebug.state().view),cells:0,' +
        'catalog:window.CleanFrameDebug.state().catalog?window.CleanFrameDebug.state().catalog.length:null,' +
        'ids:[].slice.call(document.querySelectorAll("[id]")).map(function(e){return e.id;}).filter(function(x){return /grid|apps/i.test(x);})};' +
        'return cells.slice(0,4).map(function(c){var cr=c.getBoundingClientRect();var m=c.querySelector(".mark");var l=c.querySelector(".label");var bd=c.querySelector(".state");' +
        'var mr=m?m.getBoundingClientRect():null;var lr=l?l.getBoundingClientRect():null;var br=bd?bd.getBoundingClientRect():null;' +
        'return {cell:[Math.round(cr.width/sc),Math.round(cr.height/sc)],' +
        'mark:mr?[Math.round((mr.left-cr.left)/sc),Math.round((mr.top-cr.top)/sc),Math.round(mr.width/sc),Math.round(mr.height/sc)]:null,' +
        'labelTop:lr?Math.round((lr.top-cr.top)/sc):null,' +
        'overRight:mr?Math.round((mr.right-cr.right)/sc):0,overBottom:mr?(lr?Math.round((mr.bottom-lr.top)/sc):Math.round((mr.bottom-cr.bottom)/sc)):0};});})()', function (o) {
        console.log('\nall apps grid: ' + JSON.stringify(o));
        cb();
      });
    }, 2600);
  });
}

function measureTiles(mode, cb) {
  js('(function(){var d=window.CleanFrameDebug;d.look({apps:"' + mode + '"});return 1;})()', function () {
    setTimeout(function () {
      js('(function(){var st=document.getElementById("stage").getBoundingClientRect();var sc=st.width/1920||1;' +
        'var tiles=[].slice.call(document.querySelectorAll(".dock .tile, .tray .tile, .shelf .tile"));' +
        'if(!tiles.length) tiles=[].slice.call(document.querySelectorAll(".tile"));' +
        'return tiles.slice(0,6).map(function(t){var tr=t.getBoundingClientRect();var m=t.querySelector(".mark");var l=t.querySelector(".label");' +
        'var mr=m?m.getBoundingClientRect():null;var lr=l?l.getBoundingClientRect():null;' +
        'return {tile:[Math.round(tr.width/sc),Math.round(tr.height/sc)],' +
        'mark:mr?[Math.round(mr.left-tr.left)/sc,Math.round((mr.top-tr.top)/sc),Math.round(mr.width/sc),Math.round(mr.height/sc)]:null,' +
        'label:lr?[Math.round((lr.top-tr.top)/sc),Math.round(lr.height/sc)]:null,' +
        'overRight:mr?Math.round((mr.right-tr.right)/sc):0,overBottom:mr?Math.round((mr.bottom-tr.bottom)/sc):0,' +
        'labelOverlap:(mr&&lr)?Math.round((mr.bottom-lr.top)/sc):0};});})()', function (o) {
        console.log('\n' + mode + ': ' + JSON.stringify(o));
        cb();
      });
    }, 500);
  });
}

function openPanel(group, cb) {
  js('(function(){var b=document.querySelector(\'[data-action="util.settings"]\');if(!b)return "no util";b.click();return "ok";})()', function () {
    setTimeout(function () {
      js('(function(){var b=document.querySelector(\'[data-action="settings.group.' + group + '"]\');if(!b)return "no row";b.click();return "ok";})()', function () {
        setTimeout(cb, 400);
      });
    }, 400);
  });
}

function report() {
  var trials = [
    { name: 'current', css: '' },
    { name: 'minh70 font34', css: '.detail-weather .setting-choice,.detail-typography .setting-choice{min-height:70px;padding:8px 18px;font-size:34px;line-height:42px}' },
    { name: 'minh60 font32', css: '.detail-weather .setting-choice,.detail-typography .setting-choice{min-height:60px;padding:5px 16px;font-size:32px;line-height:40px}.detail-weather .setting-options,.detail-typography .setting-options{gap:2px}' },
    { name: 'minh56 font30', css: '.detail-weather .setting-choice,.detail-typography .setting-choice{min-height:56px;padding:4px 16px;font-size:30px;line-height:38px}.detail-weather .setting-options,.detail-typography .setting-options{gap:2px}' }
  ];
  var i = 0;
  (function step() {
    if (i >= trials.length) {
      js('(function(){var s=document.getElementById("measureStyle");if(s)s.remove();return 1;})()', function () { client.close(); process.exit(0); });
      return;
    }
    var t = trials[i++];
    js('(function(){var s=document.getElementById("measureStyle");if(!s){s=document.createElement("style");s.id="measureStyle";document.head.appendChild(s);}s.textContent=' + JSON.stringify(t.css) + ';return s.textContent.length;})()', function () {
      setTimeout(function () {
        js('(function(){var rows=document.querySelector(".appearance-rows");var st=document.getElementById("stage").getBoundingClientRect();var sc=st.width/1920||1;' +
          'var items=[].slice.call(rows.querySelectorAll(".setting-choice"));var mb=0;items.forEach(function(el){mb=Math.max(mb,(el.getBoundingClientRect().bottom-st.top)/sc);});' +
          'var ch=items.length?Math.round(items[0].getBoundingClientRect().height/sc):0;' +
          'var secs=[].slice.call(rows.children).map(function(el){return Math.round(el.getBoundingClientRect().height/sc);});' +
          'return {bottom:Math.round(mb),choice:ch,sections:secs,items:items.length};})()', function (o) {
          console.log(t.name + ': ' + JSON.stringify(o));
          step();
        });
      }, 250);
    });
  })();
}
