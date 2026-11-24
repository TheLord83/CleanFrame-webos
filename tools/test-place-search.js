/* Ort suchen am Fernseher: Feld, Tastatur, Treffer, und der Weg WIEDER HERAUS.
 *
 *   node tools/test-place-search.js --port 9333
 *
 * Der Fall, an dem es scheiterte (Rueckmeldung vom 24.11.): nach dem Suchen
 * blieb der Fokus im Eingabefeld, also blieb die webOS-Bildschirmtastatur offen
 * und die Treffer waren mit der Fernbedienung nicht erreichbar. Aussteigen ging
 * nur durch Schliessen der Seite.
 *
 * Deshalb prueft diese Datei genau diese Uebergaenge: OK im Feld sucht UND gibt
 * den Fokus an die Treffer ab, runter/hoch wandern in der Liste, hoch vom ersten
 * Treffer fuehrt zurueck ins Feld, OK nimmt den markierten Ort, und zurueck
 * verlaesst am Ende das Blatt.
 *
 * Der Hub wird nachgestellt (window.fetch), damit die Pruefung nicht vom
 * Geocoder im Netz abhaengt und immer dieselben zwei Kandidaten sieht.
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
async function readCalls() {
  var raw = await ev('(function(){try{return JSON.stringify(window.__calls||[]);}catch(e){return "[]";}})()');
  try { return JSON.parse(raw); } catch (e) { return []; }
}

/* Nur die Wetter-Endpunkte werden nachgestellt. Alles andere (etwa /api/config,
 * das die Seite nach dem Uebernehmen nachlaedt) geht an den echten Hub - sonst
 * bekaeme die Seite eine Antwort ohne Inhalt und der Test wuerde den Stub
 * pruefen statt die App. */
var STUB = "window.__orig = window.__orig || window.fetch;" +
  "window.__calls = [];" +
  "window.fetch = function (url, opts) {" +
  "  if (String(url).indexOf('/api/weather/') < 0) return window.__orig(url, opts);" +
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

function state() {
  return ev("JSON.stringify({view: CleanFrameDebug.state().view,"
    + " feld: !!document.getElementById('placeSearchInput'),"
    + " fokus: (document.activeElement||{}).id || '',"
    + " treffer: document.querySelectorAll('#placeSearchResults .settings-group').length,"
    + " markiert: (function(){var e=document.querySelector('#placeSearchResults .settings-group.is-focus .settings-group-name');return e?e.textContent:null;})(),"
    + " hinweis: (document.getElementById('placeSearchHint')||{}).innerText || ''})");
}
function typeIn(txt) {
  return ev("(function(){var el=document.getElementById('placeSearchInput');el.value=" + JSON.stringify(txt) + ";"
    + "el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
}

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

  /* ---- 1. Der Ort ist die Suche: ein Druck, ein Feld mit Fokus ---- */
  await ev('CleanFrameDebug.openPlace()');
  await sleep(450);
  var a = JSON.parse(await state());
  check(a.view === 'placesearch', 'der Ort oeffnet direkt die Suche', a.view);
  check(a.feld === true, 'mit einem echten Eingabefeld');
  check(a.fokus === 'placeSearchInput', 'das den Fokus hat (dann blendet webOS die Tastatur ein)', 'fokus=' + a.fokus);

  /* ---- 2. OK im Feld sucht UND laesst den Fokus aus dem Feld ---- */
  await typeIn('Kiel');
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(650);
  var calls = await readCalls();
  var search = calls.filter(function (c) { return /\/api\/weather\/places/.test(c.url); })[0];
  check(!!search, 'OK im Feld schickt die Suche an den Hub');
  check(search && /q=Kiel/.test(search.url), 'mit dem getippten Namen', search ? search.url : '-');

  var b = JSON.parse(await state());
  check(b.treffer === 2, 'beide Kandidaten stehen als Zeile da', 'treffer=' + b.treffer);
  check(b.fokus !== 'placeSearchInput', 'nach dem Suchen ist der Fokus NICHT mehr im Feld (Tastatur geht zu)', 'fokus=' + b.fokus);
  check(/Holstein/.test(String(b.markiert)), 'und der erste Treffer ist markiert', String(b.markiert));

  /* ---- 3. Runter/hoch wandern in der Liste ---- */
  await ev("CleanFrameDebug.press(['down'])");
  await sleep(200);
  var c = JSON.parse(await state());
  check(/Wisconsin/.test(String(c.markiert)), 'runter markiert den zweiten Treffer', String(c.markiert));
  await ev("CleanFrameDebug.press(['up'])");
  await sleep(200);
  var d = JSON.parse(await state());
  check(/Holstein/.test(String(d.markiert)), 'hoch geht wieder auf den ersten', String(d.markiert));

  /* ---- 4. Hoch vom ersten Treffer fuehrt zurueck ins Feld ---- */
  await ev("CleanFrameDebug.press(['up'])");
  await sleep(300);
  var e2 = JSON.parse(await state());
  check(e2.fokus === 'placeSearchInput', 'hoch vom ersten Treffer setzt den Fokus ins Feld', 'fokus=' + e2.fokus);

  /* ---- 5. Runter verlaesst das Feld wieder ---- */
  await ev("CleanFrameDebug.press(['down'])");
  await sleep(300);
  var f = JSON.parse(await state());
  check(f.fokus !== 'placeSearchInput', 'runter verlaesst das Feld wieder', 'fokus=' + f.fokus);
  check(/Holstein/.test(String(f.markiert)), 'und markiert den ersten Treffer', String(f.markiert));

  /* ---- 6. OK nimmt den markierten Ort ---- */
  await ev("CleanFrameDebug.press(['down','ok'])");
  await sleep(700);
  calls = await readCalls();
  var apply = calls.filter(function (c) { return /\/api\/weather\/place/.test(c.url) && !/places/.test(c.url); })[0];
  check(!!apply, 'OK auf einem Treffer schickt ihn an /api/weather/place');
  check(apply && apply.method === 'POST', 'als POST, weil er schreibt', apply ? apply.method : '-');
  check(apply && /Kiel, US/.test(apply.body), 'und zwar den AUSGEWAEHLTEN, nicht den ersten', apply ? String(apply.body).slice(0, 50) : '-');
  var after = JSON.parse(await state());
  check(after.view !== 'placesearch', 'nach dem Uebernehmen ist die Suche zu', after.view);

  /* ---- 7. Zurueck geht aus dem Blatt, nicht in die Tastatur ---- */
  await ev('CleanFrameDebug.openPlace()');
  await sleep(450);
  await typeIn('Ham');
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(650);
  var g0 = JSON.parse(await state());
  check(g0.fokus !== 'placeSearchInput', 'in den Treffern ist das Feld nicht fokussiert', 'fokus=' + g0.fokus);
  await ev("CleanFrameDebug.press(['back'])");
  await sleep(300);
  var g = JSON.parse(await state());
  check(g.view !== 'placesearch', 'Zurueck in den Treffern verlaesst die Suche', g.view);

  /* Dasselbe direkt aus dem Feld: dort wird der Tastendruck vom Eingabefeld
   * gefangen, deshalb wird er hier am Feld selbst ausgeloest. */
  await ev('CleanFrameDebug.openPlace()');
  await sleep(450);
  var backFired = await ev("(function(){var el=document.getElementById('placeSearchInput');if(!el)return 'kein-feld';el.focus();var ev2=new KeyboardEvent('keydown',{keyCode:27,which:27,bubbles:true,cancelable:true});el.dispatchEvent(ev2);return true;})()");
  await sleep(350);
  var h = JSON.parse(await state());
  check(backFired === true && h.view !== 'placesearch', 'Zurueck im Feld schliesst das Blatt', 'view=' + h.view);
  check(h.fokus !== 'placeSearchInput', 'und laesst die Tastatur nicht offen', 'fokus=' + h.fokus);

  /* ---- 8. Kein Treffer ist eine Antwort, kein Absturz ---- */
  await ev("window.fetch = function(){ return Promise.resolve({ ok: true, json: function(){ return Promise.resolve({ ok: true, results: [] }); } }); }; true");
  await ev('CleanFrameDebug.openPlace()');
  await sleep(450);
  await typeIn('Xyzzy');
  await ev("CleanFrameDebug.press(['ok'])");
  await sleep(650);
  /* Die Meldung steht seit 0.6.59 in der Statuszeile unter dem Feld, nicht mehr
   * in der Trefferliste - sonst schob sie die Treffer nach unten und stand
   * mitten zwischen ihnen. */
  var i2 = await ev("(document.getElementById('placeSearchStatus')||{}).innerText || ''");
  check(/Kein Ort|No place found/.test(String(i2)), 'ohne Treffer sagt die Seite das', String(i2).slice(0, 60));
  var j = JSON.parse(await state());
  check(j.fokus === 'placeSearchInput', 'und der Fokus bleibt im Feld, damit man weitertippen kann', 'fokus=' + j.fokus);

  console.log('\nRESULT ' + passed + '/' + (passed + failed));
  if (failed) { console.log('FAILED: ' + problems.join(' | ')); process.exit(1); }
  process.exit(0);
}
main().catch(function (e) { console.log('  FAIL  ' + e.message); process.exit(1); });
