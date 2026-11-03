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
function dump(tag, cb){
  js('(function(){var o=CleanFrameDebug.focus();var l=CleanFrameDebug.layout();' +
     'var rows=[];var secs=document.querySelectorAll(".setting-section");' +
     'for(var i=0;i<secs.length;i++){var b=secs[i].querySelector(".pick-row");var lb=secs[i].querySelector(".setting-label");' +
     'rows.push({q:lb?lb.textContent.trim():"",v:b?b.querySelector(".setting-name").textContent.trim():"(offen)",open:!!secs[i].className.match(/is-open/),y:Math.round(secs[i].getBoundingClientRect().top)});}' +
     'return JSON.stringify({f:o,rows:rows,lowest:l.lowest,air:l.air,fits:l.fits,ov:l.overlaps});})()', function(v){
    var d=JSON.parse(v);
    console.log('--- ' + tag + '  action=' + d.f.action + ' r' + d.f.row + 'c' + d.f.column);
    d.rows.forEach(function(r){ console.log('    y' + r.y + (r.open?' [AUF]':'      ') + ' ' + r.q + ' = ' + r.v); });
    console.log('    lowest=' + d.lowest + ' air=' + d.air + ' fits=' + d.fits + ' ueberlappung=' + JSON.stringify(d.ov||[]));
    cb();
  });
}
function step(list, i){
  if (i >= list.length) { client.close(); process.exit(0); return; }
  var s = list[i];
  go(s.keys, function(){ setTimeout(function(){ dump(s.tag, function(){ step(list, i+1); }); }, 800); });
}
http.get({ host:'127.0.0.1', port:PORT, path:'/json/list' }, function(res){
  var b=''; res.on('data',function(c){b+=c;}); res.on('end', function(){
    var page=JSON.parse(b).filter(function(t){return t.type==='page';})[0];
    client=wsConnect(page.webSocketDebuggerUrl, function(raw){
      var m=JSON.parse(raw); if(m.id&&waiting[m.id]){waiting[m.id](m);delete waiting[m.id];}
    }, function(){
      send('Page.enable',{}, function(){ send('Page.navigate',{url:PAGE}, function(){
        setTimeout(function(){
          go(['down','ok','right','down','ok'], function(){
            setTimeout(function(){
              step([
                {keys:[],tag:'Wetter zugeklappt'},
                {keys:['down'],tag:'runter auf Groesse'},
                {keys:['ok'],tag:'Groesse aufgeklappt'},
                {keys:['down'],tag:'runter -> zuklappen + weiter'},
                {keys:['up','up'],tag:'zurueck auf Anzeige'},
                {keys:['ok'],tag:'Anzeige aufgeklappt'},
                {keys:['right'],tag:'rechts in den Antworten'},
                {keys:['ok'],tag:'OK -> uebernommen und zu'}
              ], 0);
            }, 1200);
          });
        }, 4500);
      }); });
    });
  });
});
