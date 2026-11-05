/* Ort-Seite: Liste, Auswahl, und kein "undefined" im Blatt.
 *
 *   node tools/test-place-sheet.js --port 9333
 *
 * Drei Faelle, alle am selben DOM gemessen:
 *
 *   1. Mit bekanntem Ort steht er als Zeile im Blatt, mit Haken, wenn er gilt.
 *   2. OK auf einen anderen Ort uebernimmt ihn (danach steht er in der Konfiguration
 *      und die Wetterseite traegt den neuen Namen).
 *   3. Ohne jeden Ort steht "No place set yet." da - und nirgends das Wort
 *      "undefined". Genau das zeigte der Fernseher: ein leeres Blatt mit
 *      "undefined" oben links, also ein Text aus einer fehlenden Quelle.
 *
 * Der Test setzt dafuer die Konfiguration am lokalen Hub und stellt sie am Ende
 * wieder her. Er laeuft gegen den Pruefstand (kein Geraet).
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var args = process.argv.slice(2);
function arg(name, dflt) { var i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
var PORT = parseInt(arg('--port', '9333'), 10);
var HUB = arg('--hub', 'http://127.0.0.1:8484');

var id = 0, ws = null, pending = {}, results = [];

function fail(msg) { console.log('  FEHL  ' + msg); process.exit(1); }
function check(ok, name, note) {
  results.push(!!ok);
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
  if (!ok) process.exitCode = 1;
}

/* Die Konfiguration traegt eine Revision; wer sie mitschickt, behauptet einen
 * alten Stand und bekommt 409. Der Test will schreiben, nicht behaupten. */
function postConfig(cfg) {
  var copy = JSON.parse(JSON.stringify(cfg));
  delete copy.rev;
  return hub('POST', '/api/config', { config: copy }).then(function (r) {
    if (!r || r.ok !== true) throw new Error('Konfiguration nicht geschrieben: ' + JSON.stringify(r).slice(0, 160));
    return r;
  });
}

function hub(method, p, body) {
  return new Promise(function (res, rej) {
    var u = new URL(HUB + p), data = body ? JSON.stringify(body) : null;
    var req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      function (r) {
        var b = ''; r.on('data', function (c) { b += c; });
        r.on('end', function () { try { res(JSON.parse(b)); } catch (e) { res(b); } });
      });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

function connect(cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
    var b = ''; res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var t = JSON.parse(b).filter(function (x) { return x.type === 'page'; })[0];
      if (!t) return fail('keine Seite im Browser');
      var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(t.webSocketDebuggerUrl);
      ws = net.connect(parseInt(m[2], 10), m[1], function () {
        ws.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      ws.once('data', function () { ws.removeAllListeners('data'); attach(); cb(); });
    });
  }).on('error', function (e) { fail('CDP auf ' + PORT + ': ' + e.message); });
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
      if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
    }
  });
}
function js(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (m) {
    var r = m.result && m.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^(TypeError|ReferenceError|SyntaxError)/.test(v)) {
      console.log('  FEHL  Seite meldet: ' + v.split('\n')[0]);
      return fail('Seitenfehler');
    }
    cb(v);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function jsP(e) { return new Promise(function (res) { js(e, res); }); }

var SHEET_DUMP = 'JSON.stringify((function(){var s=document.querySelector("#sheetView");'
  + 'return {text: s ? s.innerText.replace(/\\s+/g," ").trim() : null, hidden: s ? s.hidden : null,'
  + ' title: s ? (s.querySelector("h2")||{}).textContent || null : null,'
  + ' rows: [].slice.call(s ? s.querySelectorAll(".settings-group-name") : []).map(function(e){return e.textContent;}),'
  + ' undefined: s ? s.innerText.indexOf("undefined") >= 0 : false};})())';

async function main() {
  await new Promise(function (r) { connect(r); });
  send('Page.navigate', { url: PAGE }, function () {});
  for (var n = 0; n < 120; n++) {
    if (await jsP('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()') === true) break;
    await sleep(100);
  }

  var backup = await hub('GET', '/api/config');
  var cfg = backup.config || backup;
  var hadPlace = ((cfg.integrations || {}).weather || {}).place || '';

  /* --- Fall 1: ein bekannter Ort --- */
  var withPlace = JSON.parse(JSON.stringify(cfg));
  withPlace.integrations = withPlace.integrations || {};
  withPlace.integrations.weather = withPlace.integrations.weather || {};
  withPlace.integrations.weather.known = [{ place: 'Kiel, DE', lat: 54.3213, lon: 10.1349 }, { place: 'Berlin, DE', lat: 52.52, lon: 13.405 }];
  withPlace.integrations.weather.place = 'Kiel, DE';
  await postConfig(withPlace);
  await jsP('CleanFrameDebug.reload ? CleanFrameDebug.reload() : 0');
  send('Page.navigate', { url: PAGE }, function () {});
  for (n = 0; n < 120; n++) {
    if (await jsP('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()') === true) break;
    await sleep(100);
  }
  await jsP('CleanFrameDebug.openPlace("Choose a place for the weather line.")');
  await sleep(500);
  var d1 = JSON.parse(await jsP(SHEET_DUMP));
  check(d1 && d1.title === 'Ort', 'Blatt traegt die Ueberschrift "Ort"', JSON.stringify(d1 && d1.title));
  check(d1 && d1.rows.length === 3, 'Suchzeile plus beide bekannten Orte stehen da', 'rows=' + (d1 && d1.rows.join(', ')));
  check(d1 && d1.rows[0] === 'Ort suchen', 'oben steht die Suche', d1 && d1.rows[0]);
  check(d1 && d1.undefined === false, 'kein "undefined" im Blatt');

  /* --- Fall 2: OK uebernimmt den zweiten Ort --- */
  await jsP('CleanFrameDebug.press(["down","down"])');
  await sleep(200);
  await jsP('CleanFrameDebug.press(["ok"])');
  await sleep(1500);
  var after = await hub('GET', '/api/config');
  var acfg = after.config || after;
  var place = ((acfg.integrations || {}).weather || {}).place || '';
  var lat = ((acfg.integrations || {}).weather || {}).lat || 0;
  check(place === 'Berlin, DE', 'OK uebernimmt den gewaehlten Ort', 'place=' + place);
  check(Math.abs(lat - 52.52) < 0.01, 'und die Koordinaten des Ortes, nicht die des alten', 'lat=' + lat);
  var d2 = JSON.parse(await jsP(SHEET_DUMP));
  check(d2 && d2.hidden === true, 'Blatt ist danach zu', 'hidden=' + (d2 && d2.hidden));

  /* --- Fall 3: gar kein Ort --- */
  var none = JSON.parse(JSON.stringify(cfg));
  none.integrations = none.integrations || {};
  none.integrations.weather = none.integrations.weather || {};
  none.integrations.weather.known = [];
  none.integrations.weather.place = '';
  none.integrations.weather.lat = 0; none.integrations.weather.lon = 0;
  await postConfig(none);
  send('Page.navigate', { url: PAGE }, function () {});
  for (n = 0; n < 120; n++) {
    if (await jsP('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()') === true) break;
    await sleep(100);
  }
  await jsP('CleanFrameDebug.openPlace("Set the place first, then the weather can show.")');
  await sleep(500);
  var d3 = JSON.parse(await jsP(SHEET_DUMP));
  check(d3 && d3.undefined === false, 'ohne Ort kein "undefined" im Blatt', JSON.stringify(d3 && d3.text));
  /* Der Text kommt aus der Sprache der App; geprueft wird, dass die Seite den
   * Zustand benennt statt leer zu bleiben ("undefined" war genau der Fehler). */
  /* Ohne einen einzigen bekannten Ort muss die Seite trotzdem einen Weg
   * anbieten: die Suche steht als Zeile 0, auch wenn die Liste leer ist. */
  check(d3 && d3.undefined === false && d3.rows.length === 1 && d3.rows[0] === 'Ort suchen',
    'ohne Ort bleibt die Suchzeile stehen', JSON.stringify(d3 && d3.rows));
  check(d3 && /eintippen|type/i.test(d3.text || ''), 'und der Hinweis nennt das Eintippen',
    JSON.stringify(d3 && d3.text));
  /* OK auf der Suchzeile oeffnet die Suche - keine Zeile, die nichts tut. */
  await jsP('CleanFrameDebug.press(["ok"])');
  await sleep(500);
  var d3b = JSON.parse(await jsP('JSON.stringify({view: CleanFrameDebug.state().view, feld: !!document.getElementById("placeSearchInput")})'));
  check(d3b && d3b.view === 'placesearch', 'OK auf der Suchzeile oeffnet die Suche', d3b && d3b.view);
  check(d3b && d3b.feld === true, 'mit einem Feld, in das man tippen kann');
  await jsP('CleanFrameDebug.press(["back"])');
  await sleep(300);

  /* Konfiguration zurueckstellen. */
  await postConfig(cfg);
  send('Page.navigate', { url: PAGE }, function () {});
  await sleep(800);
  var restored = await hub('GET', '/api/config');
  var rcfg = restored.config || restored;
  var rplace = ((rcfg.integrations || {}).weather || {}).place || '';
  check(rplace === hadPlace, 'Konfiguration wiederhergestellt', 'place=' + rplace);

  console.log('\nRESULT ' + results.filter(Boolean).length + '/' + results.length);
  process.exit(process.exitCode || 0);
}
main();
