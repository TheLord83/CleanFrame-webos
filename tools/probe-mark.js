/* Diagnose fuer alle Logos: Zeilenstil, Boxen, Abstand zum Namen.
 *
 *   node tools/probe-mark.js
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
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
function send(method, params, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: method, params: params || {} }); }
function js(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined);
  });
}

var PROBE = [
  '(function(){',
  'var out=[];',
  '[].slice.call(document.querySelectorAll("#dock .tile")).forEach(function(t){',
  '  var mark=t.querySelector(".mark"), mk=t.querySelector(".mk"), label=t.querySelector(".label");',
  '  if(!mk||!label) return;',
  '  var tr=t.getBoundingClientRect(), mr=mk.getBoundingClientRect(), lr=label.getBoundingClientRect();',
  '  out.push({name:label.textContent, id:mark?mark.getAttribute("data-mark"):"?",',
  '    style:mk.getAttribute("style"),',
  '    mkTop:Math.round(mr.top-tr.top), mkH:Math.round(mr.height), mkW:Math.round(mr.width),',
  '    labelTop:Math.round(lr.top-tr.top), gap:Math.round(lr.top-mr.bottom)});',
  '});',
  'return JSON.stringify(out);})()'
].join('');

http.get({ host: '127.0.0.1', port: 9333, path: '/json/list' }, function (res) {
  var body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    var page = JSON.parse(body).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    }, function () {
      send('Network.enable', {}, function () {
        send('Network.setCacheDisabled', { cacheDisabled: true }, function () {
          send('Page.enable', {}, function () {
            send('Page.navigate', { url: PAGE }, function () {
              setTimeout(function () {
                js(PROBE, function (r) {
                  try {
                    JSON.parse(r).forEach(function (x) {
                      console.log(x.name + '  [' + x.id + ']');
                      console.log('   style: ' + String(x.style).replace(/-webkit-mask-image:[^;]*;?/g, ''));
                      console.log('   box: ' + x.mkW + 'x' + x.mkH + ' top=' + x.mkTop + '  Name ab ' + x.labelTop + '  Abstand ' + x.gap);
                    });
                  } catch (e) { console.log(r); }
                  js('(function(){' +
                     'var m=window.FrameIconMetrics.disneyplus;' +
                     'var W=232,H=124,SIZE=66;' +
                     'var weight=Math.max(0.84,Math.min(1.25,Math.pow(0.45/m.fill,0.3)));' +
                     'var k=Math.min(W/m.w,H/m.h,SIZE*weight/m.h);' +
                     'var mk=document.querySelector("[data-mark=disneyplus] .mk");' +
                     'var lbl=document.querySelector("[data-mark=disneyplus]").parentNode;' +
                     'return JSON.stringify({weight:weight,k:k,drawn:m.h*k,width:m.w*k,' +
                     'styleStr:mk.getAttribute("style"),' +
                     'markClass:document.querySelector("[data-mark=disneyplus]").className,' +
                     'fieldW:document.querySelector("[data-mark=disneyplus]").style.width,' +
                     'fieldH:document.querySelector("[data-mark=disneyplus]").style.height});})()', function (extra) {
                    console.log('RECHNUNG IM BROWSER: ' + extra);
                    client.close(); process.exit(0);
                  });

                });
              }, 4500);
            });
          });
        });
      });
    });
  });
});
