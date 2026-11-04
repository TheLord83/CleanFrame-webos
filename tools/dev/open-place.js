/* Ort-Seite im Kopflauf oeffnen, DOM und Fehler ausgeben.
 *
 *   node tools/dev/open-place.js [--port 9333]
 *
 * Einmal-Sonde: auf dem Fernseher zeigte die Ortsauswahl nur "undefined".
 * Dieses Skript oeffnet dieselbe Seite ueber denselben Weg wie der Fernseher
 * (openPlaceInput ueber den Wetter-Zweig) und druckt, was im Blatt steht -
 * inklusive der Konsolenfehler, die der Pruefstand sonst verschluckt.
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'app', 'index.html');
var i = process.argv.indexOf('--port');
var PORT = i > 0 ? parseInt(process.argv[i + 1], 10) : 9333;
var id = 0, ws = null, pending = {}, logs = [];

function connect(cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
    var b = ''; res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var t = JSON.parse(b).filter(function (x) { return x.type === 'page'; })[0];
      var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(t.webSocketDebuggerUrl);
      ws = net.connect(parseInt(m[2], 10), m[1], function () {
        ws.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      ws.once('data', function () { ws.removeAllListeners('data'); attach(); cb(); });
    });
  });
}
function send(method, params, cb) {
  var mid = ++id, p = Buffer.from(JSON.stringify({ id: mid, method: method, params: params || {} }));
  var head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 0xff]);
  var mask = crypto.randomBytes(4), body = Buffer.alloc(p.length);
  for (var k = 0; k < p.length; k++) body[k] = p[k] ^ mask[k % 4];
  ws.write(Buffer.concat([head, mask, body]));
  if (cb) pending[mid] = cb;
}
function attach() {
  var buf = Buffer.alloc(0);
  ws.on('data', function (c) {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      if (buf.length < 2) return;
      var len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      var frame = buf.slice(off, off + len); buf = buf.slice(off + len);
      var msg; try { msg = JSON.parse(frame.toString('utf8')); } catch (e) { continue; }
      if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push((msg.params.type || '') + ': ' + (msg.params.args || []).map(function (a) { return a.value || a.description || ''; }).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        var ex = msg.params.exceptionDetails || {};
        logs.push('EXCEPTION: ' + (ex.exception && (ex.exception.description || ex.exception.value) || ex.text));
      }
      if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
    }
  });
}
function js(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (m) {
    var r = m.result && m.result.result;
    cb(r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function jsP(e) { return new Promise(function (res) { js(e, res); }); }

async function main() {
  await new Promise(function (r) { connect(r); });
  send('Runtime.enable', {});
  send('Page.enable', {});
  send('Page.navigate', { url: PAGE }, function () {});
  for (var n = 0; n < 120; n++) {
    var ready = await jsP('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()');
    if (ready === true) break;
    await sleep(100);
  }
  console.log('bereit');
  /* Derselbe Weg wie am Geraet: Wetter-Seite ohne Ort, Anzeige einschalten. */
  await jsP('CleanFrameDebug.goTo("settings.group.weather")');
  await sleep(600);
  var opened = await jsP('(function(){CleanFrameDebug.press(["ok"]); return CleanFrameDebug.state().id || "";})()');
  await sleep(500);
  var after = await jsP('JSON.stringify({view: (CleanFrameDebug.state()||{}).id, zone: (CleanFrameDebug.state()||{}).zone})');
  console.log('nach OK auf Wetter:', after);
  await jsP('CleanFrameDebug.press(["ok"])');   /* Anzeige aufklappen */
  await sleep(400);
  await jsP('CleanFrameDebug.press(["down"])');
  await jsP('CleanFrameDebug.press(["ok"])');   /* Einschaltversuch ohne Ort */
  await sleep(700);
  console.log('view:', await jsP('JSON.stringify(CleanFrameDebug.state())'));
  console.log('--- Blatt-Inhalt ---');
  console.log(await jsP('(function(){var s=document.querySelector("#sheetView"); return s ? s.innerText.slice(0,600) : "kein #sheetView";})()'));
  console.log('--- HTML-Ausschnitt ---');
  console.log(await jsP('(function(){var s=document.querySelector("#sheetView"); return s ? s.innerHTML.slice(0,700) : "-";})()'));
  console.log('--- Konsole ---');
  console.log(logs.join('\n') || '(leer)');
  process.exit(0);
}
main();
