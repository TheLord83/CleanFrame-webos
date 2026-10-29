/* Kommt man in der Listenansicht von den Zeilen zu den Werkzeugen und zurueck?
 *
 *   node tools/test-list-utils.js
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var PORT = (function () { var i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 9333; })();

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
      else if (len === 127) { if (tail.length < 10) return; len = Number(tail.readBigUInt64BE(2)); off = 10; }
      if (tail.length < off + len) return;
      var p = tail.slice(off, off + len); tail = tail.slice(off + len);
      if (op === 1) onMessage(p.toString('utf8'));
      else if (op === 8) { sock.end(); return; }
    }
  });
  api = { send: function (o) {
      var b = Buffer.from(JSON.stringify(o), 'utf8'), h;
      if (b.length < 126) h = Buffer.from([0x81, 0x80 | b.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(b.length, 2); }
      var mk = crypto.randomBytes(4), out = Buffer.alloc(b.length);
      for (var i = 0; i < b.length; i++) out[i] = b[i] ^ mk[i % 4];
      sock.write(Buffer.concat([h, mk, out]));
    }, close: function () { try { sock.end(); } catch (x) {} } };
  return api;
}
var client, id = 0, waiting = {};
function send(me, pa, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: me, params: pa || {} }); }
function js(e, cb) { send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) { var r = msg.result && msg.result.result; cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined); }); }
function key(name, cb) {
  var M = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] }[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb || function () {}, 280); });
  });
}

function ev(e, cb){ js(e, function(v){ cb(JSON.parse(v)); }); }
function go(keys, cb){ ev('JSON.stringify(CleanFrameDebug.press('+JSON.stringify(keys)+'))', cb); }

function goTo(action, cb, tries){ tries=tries||0; if(tries>18) return cb(false);
  ev('JSON.stringify(CleanFrameDebug.focus())', function(f){
    if(f.action===action) return cb(true);
    go(['down'], function(f2){ if(f2.action===f.action) go(['right'], function(){ goTo(action,cb,tries+1); }); else goTo(action,cb,tries+1); });
  });
}
function toSettings(cb, tries){ tries=tries||0;
  ev('JSON.stringify(CleanFrameDebug.focus())', function(f){
    if(f.view==='settings') return cb();
    if(f.view!=='home') return go(['back'], function(){ toSettings(cb,tries+1); });
    go(['down'], function(){ go(['ok'], function(){ toSettings(cb,tries+1); }); });
  });
}
http.get({ host:'127.0.0.1', port:PORT, path:'/json/list' }, function(res){
  var b=''; res.on('data',function(c){b+=c;}); res.on('end', function(){
    var page=JSON.parse(b).filter(function(t){return t.type==='page';})[0];
    client=wsConnect(page.webSocketDebuggerUrl, function(raw){
      var m=JSON.parse(raw); if(m.id&&waiting[m.id]){waiting[m.id](m);delete waiting[m.id];}
    }, function(){
      send('Page.enable',{}, function(){ send('Page.navigate',{url:PAGE}, function(){
        setTimeout(function(){
          toSettings(function(){
            goTo('settings.group.weather', function(ok){
              if(!ok){ console.log('Wetter nicht erreichbar'); client.close(); process.exit(1); }
              go(['ok'], function(){ setTimeout(function(){
                go(['ok'], function(){ setTimeout(function(){
                  js('(function(){var sc=document.getElementById("scene").getBoundingClientRect();var k=sc.width/1920;' +
                     'var card=document.querySelector(".picker-list");var rows=document.querySelector(".detail-weather .appearance-rows");' +
                     'function rr(el){var r=el.getBoundingClientRect();return {l:Math.round((r.left-sc.left)/k),rt:Math.round((r.right-sc.left)/k),b:Math.round((r.bottom-sc.top)/k)};}' +
                     'var l=CleanFrameDebug.layout();return JSON.stringify({vw:window.innerWidth,scale:Math.round(k*1000)/1000,card:card?rr(card):null,rows:rows?rr(rows):null,lowest:l.lowest,air:l.air,n:l.items.length});})()', function(v){
                    var d=JSON.parse(v);
                    console.log('Fenster ' + d.vw + ' px, Skala ' + d.scale);
                    console.log('Spalte: x' + (d.rows?d.rows.l:'-') + '..' + (d.rows?d.rows.rt:'-'));
                    console.log('Karte : x' + (d.card?d.card.l:'-') + '..' + (d.card?d.card.rt:'-') + '  unten y' + (d.card?d.card.b:'-'));
                    console.log('layout: lowest=' + d.lowest + ' air=' + d.air + ' n=' + d.n);
                    client.close(); process.exit(0);
                  });
                }, 1200); });
              }, 900); });
            });
          });
        }, 4400);
      }); });
    });
  });
});
