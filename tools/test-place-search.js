/* Ort suchen am Fernseher: Eingabefeld, Trefferliste, Uebernehmen.
 *
 *   node tools/test-place-search.js --port 9333
 *
 * Warum das eine eigene Pruefung ist: die Ortsseite konnte vorher nur Orte
 * anzeigen, die der Hub schon kannte. Wer einen NEUEN Ort wollte, musste in den
 * Browser - am Fernseher der falsche Ort dafuer.
 *
 * Der Hub wird nachgestellt (window.fetch), damit die Pruefung nicht vom
 * Geocoder im Netz abhaengt und immer dieselben zwei Kandidaten sieht:
 * "Kiel, DE" und "Kiel, US". Was geprueft wird, ist die Seite: dass ein echtes
 * Eingabefeld den Fokus bekommt, dass OK sucht, dass die Treffer als Zeilen
 * dastehen, dass OK auf einem Treffer den Namen an den Hub schickt - und dass
 * "zurueck" erst ins Feld und dann aus dem Blatt fuehrt.
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var args = process.argv.slice(2);
function arg(n, d) { var i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }
var PORT = parseInt(arg('--port', '9333'), 10);

var id = 0, ws = null, pending = {}, passed = 0, failed = 0, problems = [];

function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; problems.push(what); console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}
function fail(msg) { console.log('  FAIL  ' + msg); process.exit(1); }

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
      var f = buf.slice(off, off + len); buf = buf.slice(off + len);
      var m; try { m = JSON.parse(f.toString('utf8')); } catch (e) { continue; }
      if (m.id && pending[m.id]) { var cb = pending[m.id]; delete pending[m.id]; cb(m); }
    }
  });
}
function ev(expr) {
  return new Promise(function (res) {
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (m) {
      var r = m.result && m.result.result;
      var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
      if (typeof v === 'string' && /^(TypeError|ReferenceError|SyntaxError)/.test(v)) fail('Seite meldet: ' + v.split('\n')[0]);
      res(v);
    });
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Der nachgestellte Hub. Er merkt sich, was die Seite geschickt hat. */
var STUB = "window.__calls = [];" +
  "window.fetch = function (url, opts) {" +
  "  window.__calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: (opts && opts.body) || '' });" +
  "  var body;" +
  "  if (String(url).indexOf('/api/weather/places') >= 0) {" +
  "    body = { ok: true, query: 'Kiel', results: [" +
  "      { name: 'Kiel, DE', label: 'Kiel · Schleswig-Holstein, DE', lat: 54.3213, lon: 10.1349 }," +
  "      { name: 'Kiel, US', label: 'Kiel · Wisconsin, US', lat: 43.9125, lon: -88.0354 } ] };" +
  "  } else if (String(url).indexOf('/api/weather/place') >= 0) {" +
  "    body = { ok: true, place: 'Kiel, US', lat: 43.9125, lon: -88.0354 };" +
  "  } else { body = { ok: true }; }" +
  "  return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });" +
  "};";

async function main() {
  await new Promise(function (res, rej) {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (r) {
      var b = ''; r.on('data', function (c) { b += c; });
      r.on('end', function () {
        var t = JSON.parse(b).filter(function (x) { return x.type === 'page'; })[0];
        if (!t) return rej(new Error('keine Seite im Browser auf Port ' + PORT));
        var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(t.webSocketDebuggerUrl);
        ws = net.connect(parseInt(m[2], 10), m[1], function () {
          ws.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
            + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
        });
        ws.once('data', function () { ws.removeAllListeners('data'); attach(); res(); });
      });
    }).on('error', rej);
  });

  await ev("localStorage.setItem('cleanframe.lang','de'); true");
  send('Page.navigate', { url: PAGE }, function () {});
  var ready = false;
  for (var n = 0; n < 150 && !ready; n++) {
    await sleep(120);
    ready = await ev('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()');
  }
  check(ready === true, 'Seite ist geladen');
  if (!ready) { process.exit(1); }

  await ev(STUB);

  /* ---- 1. Die Ortsseite hat die Suchzeile als erste Zeile ---- */
  await ev('CleanFrameDebug.openPlace()');
  await sleep(400);
  var rows = JSON.parse(await ev("JSON.stringify([].slice.call(document.querySelectorAll('#sheetView .settings-group-name')).map(function(e){return e.textContent;}))"));
  check(rows.length >= 1 && /Ort suchen/.test(rows[0]), 'die erste Zeile der Ortsseite ist die Suche', JSON.stringify(rows));

  /* ---- 2. OK darauf oeffnet ein Feld mit Fokus ---- */
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(500);
  var st = JSON.parse(await ev("JSON.stringify({view: CleanFrameDebug.state().view, feld: !!document.getElementById('placeSearchInput'), fokus: (document.activeElement||{}).id || ''})"));
  check(st.view === 'placesearch', 'OK auf der Suchzeile oeffnet die Suche', st.view);
  check(st.feld === true, 'und es gibt ein echtes Eingabefeld');
  check(st.fokus === 'placeSearchInput', 'das den Fokus hat (dann blendet webOS die Tastatur ein)', 'fokus=' + st.fokus);

  /* ---- 3. Tippen und OK sucht ---- */
  await ev("(function(){var el=document.getElementById('placeSearchInput');el.value='Kiel';"
    + "el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(600);
  var calls = JSON.parse(await ev('JSON.stringify(window.__calls)'));
  var search = calls.filter(function (c) { return /\/api\/weather\/places/.test(c.url); })[0];
  check(!!search, 'OK schickt die Suche an den Hub', JSON.stringify(calls.map(function (c) { return c.url; })));
  check(search && /q=Kiel/.test(search.url), 'mit dem getippten Namen in der Adresse', search ? search.url : '-');

  var hits = JSON.parse(await ev("JSON.stringify([].slice.call(document.querySelectorAll('#placeSearchResults .settings-group-name')).map(function(e){return e.textContent;}))"));
  check(hits.length === 2, 'beide Kandidaten stehen als Zeile da', JSON.stringify(hits));
  check(/Kiel . Schleswig|Kiel .*Holstein/.test(hits[0] || ''), 'mit Region, damit man sie unterscheiden kann', hits[0] || '');
  check(/Wisconsin/.test(hits[1] || ''), 'und der zweite ist der andere Kiel', hits[1] || '');

  /* ---- 4. Der Fokus steht auf dem ersten Treffer, OK nimmt ihn ---- */
  var fok = await ev("JSON.stringify({i: (function(){var e=document.querySelector('#placeSearchResults .settings-group.is-focus .settings-group-name');return e?e.textContent:null;})()})");
  check(/Holstein/.test(String(fok)), 'der erste Treffer ist hervorgehoben', fok);

  await ev("CleanFrameDebug.press(['down','ok'])");
  await sleep(700);
  calls = JSON.parse(await ev('JSON.stringify(window.__calls)'));
  var apply = calls.filter(function (c) { return /\/api\/weather\/place/.test(c.url) && !/places/.test(c.url); })[0];
  check(!!apply, 'OK auf einem Treffer schickt ihn an /api/weather/place', JSON.stringify(calls.map(function (c) { return c.url; })));
  check(apply && apply.method === 'POST', 'als POST, weil er schreibt', apply ? apply.method : '-');
  check(apply && /Kiel, US/.test(apply.body), 'und zwar den AUSGEWAEHLTEN, nicht den ersten', apply ? apply.body.slice(0, 60) : '-');
  var after = JSON.parse(await ev("JSON.stringify({view: CleanFrameDebug.state().view})"));
  check(after.view !== 'placesearch', 'nach dem Uebernehmen ist die Suche zu', after.view);

  /* ---- 5. Zurueck fuehrt erst ins Feld, dann aus dem Blatt ---- */
  await ev('CleanFrameDebug.openPlace()');
  await sleep(300);
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(400);
  await ev("(function(){var el=document.getElementById('placeSearchInput');el.value='Ham';el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(500);
  await ev("CleanFrameDebug.press(['back'])");
  await sleep(300);
  var mid = JSON.parse(await ev("JSON.stringify({view: CleanFrameDebug.state().view, fokus: (document.activeElement||{}).id || ''})"));
  check(mid.view === 'placesearch', 'erster Zurueck bleibt in der Suche', mid.view);
  check(mid.fokus === 'placeSearchInput', 'und setzt den Fokus zurueck ins Feld', 'fokus=' + mid.fokus);
  await ev("CleanFrameDebug.press(['back'])");
  await sleep(300);
  var out = JSON.parse(await ev("JSON.stringify({view: CleanFrameDebug.state().view})"));
  check(out.view === 'place', 'zweiter Zurueck geht zurueck auf die Ortsliste', out.view);

  /* ---- 6. Kein Treffer ist eine Antwort, kein Absturz ---- */
  await ev("window.fetch = function(){ return Promise.resolve({ ok: true, json: function(){ return Promise.resolve({ ok: true, results: [] }); } }); }; true");
  await ev('CleanFrameDebug.openPlace()');
  await sleep(250);
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(350);
  await ev("(function(){var el=document.getElementById('placeSearchInput');el.value='Xyzzy';el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(600);
  var empty = await ev("document.getElementById('placeSearchResults').innerText.replace(/\\s+/g,' ')");
  check(/Kein Ort|No place found/.test(String(empty)), 'ohne Treffer sagt die Seite das', String(empty).slice(0, 80));

  console.log('\nRESULT ' + passed + '/' + (passed + failed));
  if (failed) { console.log('FAILED: ' + problems.join(' | ')); process.exit(1); }
  process.exit(0);
}
main().catch(function (e) { console.log('  FAIL  ' + e.message); process.exit(1); });
