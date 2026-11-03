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
var consoleErrors = [];
function js(e, cb) {
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    /* Ein Fehler in der Seite kommt als Text zurueck und liess das Werkzeug
     * vorher mit "Unexpected token" abbrechen, ohne zu sagen, was kaputt ist. */
    if (finished) return;
    if (typeof v === 'string' && /^(TypeError|ReferenceError|SyntaxError)/.test(v)) {
      console.log('  FEHL  Seite meldet:');
      console.log(v.split('\n').slice(0, 8).map(function (l) { return '        ' + l; }).join('\n'));
      finish();
      return;
    }
    cb(v);
  });
}
function key(name, cb) {
  var M = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], ok: ['Enter', 13] }[name];
  send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () {
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: M[0], code: M[0], windowsVirtualKeyCode: M[1] }, function () { setTimeout(cb || function () {}, 280); });
  });
}

/* Prueft die aufklappbaren Zeilen (TV-Variante des Dropdowns): Zeile zeigt den
 * Wert, OK klappt die Antworten als Karte darueber auf, hoch/runter geht weiter,
 * und die aufgeklappte Karte darf nicht aus dem Bild oder ueber Nachbarzeilen.
 *
 *   node tools/test-picker.js --port 9333
 */
var MIN_AIR = 30, results = [], finished = false;

function ev(e, cb) { js(e, function (v) { cb(JSON.parse(v)); }); }
function press(keys, cb) { ev('JSON.stringify(CleanFrameDebug.press(' + JSON.stringify(keys) + '))', cb); }
function check(ok, name, note) {
  results.push({ ok: ok, name: name });
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
}
function rows(cb) {
  ev('(function(){var out=[];var s=document.querySelectorAll(".setting-section");' +
     'for(var i=0;i<s.length;i++){var b=s[i].querySelector(".pick-row"),l=s[i].querySelector(".setting-label");' +
     'var v=b?b.querySelector(".setting-name").textContent.trim():null;' +
     'if(!v){var n=s[i].querySelector(".setting-name");v=n?n.textContent.trim():null;}' +
     'if(!b&&!l)continue;out.push({q:l?l.textContent.trim():"",v:v,' +
     'open:!!s[i].className.match(/is-open/),covered:!!s[i].className.match(/is-covered/),' +
     'opts:s[i].querySelectorAll(".picker-list .setting-choice").length});}' +
     'var card=document.querySelector(".picker-list");' +
     'return JSON.stringify({sections:out,cardW:card?Math.round(parseFloat(getComputedStyle(card).width)):0});})()', cb);
}
function goTo(action, cb, tries) {
  tries = tries || 0;
  if (tries > 22) return cb(false);
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.action === action) return cb(true);
    /* Die Einstellungsliste ist zweispaltig: runter bis zum Ende, dann rechts
     * in die zweite Spalte und dort nach oben - oder direkt hoch, wenn der
     * Eintrag weiter oben steht. */
    var useUp = (tries % 3) === 2;
    press([useUp ? 'up' : 'down'], function (f2) {
      if (f2.action === f.action) press(['right'], function () { goTo(action, cb, tries + 1); });
      else goTo(action, cb, tries + 1);
    });
  });
}
function toSettings(cb, tries) {
  tries = tries || 0;
  ev('JSON.stringify(CleanFrameDebug.focus())', function (f) {
    if (f.view === 'settings') return cb();
    /* Ein offener Hinweis (z. B. der Einrichtungs-Dialog auf der letzten Zeile)
     * wird mit OK geschlossen - "back" wuerde aus den Einstellungen herausfuehren. */
    if (f.view === 'message') return press(['ok'], function () { toSettings(cb, tries + 1); });
    if (f.view !== 'home') return press(['back'], function () { toSettings(cb, tries + 1); });
    press(['down'], function () { press(['ok'], function () { toSettings(cb, function () { cb(); }, tries + 1); }); });
  });
}
function openWeather(cb) {
  toSettings(function () {
    goTo('settings.group.weather', function (ok) {
      if (!ok) return cb(false);
      press(['ok'], function () { setTimeout(function () { cb(true); }, 700); });
    });
  });
}
function layout(cb) { ev('JSON.stringify(CleanFrameDebug.layout())', cb); }

/* ---- Ablauf -------------------------------------------------------------
 * Eine gerade Kette statt fuenf verschachtelter Rueckrufe. Bei den
 * verschachtelten Ebenen hatte sich zuletzt eine Klammer verlaufen, und eine
 * fehlende Klammer haengt den ganzen Lauf ohne Meldung.
 */
function P(fn) {
  return function () {
    var a = Array.prototype.slice.call(arguments);
    return new Promise(function (res) {
      a.push(function (v) { res(v); });
      fn.apply(null, a);
    });
  };
}
var evP = P(ev), jsP = P(js), pressP = P(press), rowsP = P(rows), layoutP = P(layout),
    backP = P(back), openWeatherP = P(openWeather);
function sendP(me, pa) { return new Promise(function (res) { send(me, pa, res); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var b = '';
  res.on('data', function (c) { b += c; });
  res.on('end', function () {
    var page = JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0];
    client = wsConnect(page.webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; return; }
      if (m.method && client.onEvent) client.onEvent(m);
    }, function () {
      client.onEvent = function (m) {
        if (m.method !== 'Runtime.exceptionThrown') return;
        var d = (m.params && m.params.exceptionDetails) || {};
        consoleErrors.push((d.exception && d.exception.description) || d.text || 'Fehler');
      };
      run().catch(function (e) { console.log('  FEHL  Lauf abgebrochen: ' + e.message); finish(); });
    });
  });
});

async function run() {
  await sendP('Runtime.enable');
  await sendP('Page.enable');
  await sendP('Page.navigate', { url: PAGE });
  /* Warten, bis die Seite steht. Feste Wartezeiten waren die Ursache fuer
   * "CleanFrameDebug is not defined": die Seite ist nach rund 260 ms bereit,
   * der Rueckruf von Page.navigate kommt je nach Last deutlich spaeter. */
  var ready = false;
  for (var i = 0; i < 60 && !ready; i++) {
    await sleep(250);
    ready = (await jsP('typeof CleanFrameDebug')) === 'object';
  }
  if (!ready) { console.log('  FEHL  Seite wurde nicht fertig geladen'); return finish(); }
  if (!(await openWeatherP())) { console.log('  FEHL  Wetterseite nicht erreichbar'); return finish(); }

  var r = (await rowsP()).sections;
  check(r.length === 5 && r.every(function (x) { return x.v; }), 'fuenf Zeilen mit Wert',
    JSON.stringify(r.map(function (x) { return x.q + '=' + x.v; })));
  check(r.every(function (x) { return !x.open; }), 'alle zugeklappt');
  var first = r[0].v;

  /* Aufklappen: die Antworten liegen als Karte ueber den folgenden Zeilen. */
  await pressP(['ok']);
  await sleep(500);
  var r2 = await rowsP();
  check(r2.sections[0].open, 'OK klappt die Zeile auf');
  check(r2.sections[0].opts === 5, 'fuenf Antworten im Panel', 'opts=' + r2.sections[0].opts);
  check(r2.cardW <= 600, 'Karte ist schmal (max 600 px)', 'Breite=' + r2.cardW + ' px');
  var cover = await evP('(function(){var c=document.querySelector(".setting-section.is-open .picker-list").getBoundingClientRect();'
    + 'var out=[];var secs=document.querySelectorAll(".setting-section");'
    + 'for(var i=0;i<secs.length;i++){if(/is-open/.test(secs[i].className))continue;var r=secs[i].getBoundingClientRect();'
    + 'var hits=r.bottom>c.top+2&&r.top<c.bottom-2;if(!hits)continue;'
    + 'var l=secs[i].querySelector(".setting-label");out.push((l?l.textContent.trim():"?")+(/is-covered/.test(secs[i].className)?"=verdeckt":"=SICHTBAR"));}'
    + 'return JSON.stringify(out);})()');
  check(cover.every(function (x) { return /verdeckt$/.test(x); }),
    'Zeilen unter der Karte sind verdeckt', cover.length ? cover.join(' ') : 'keine betroffen');

  var l = await layoutP();
  check(l.fits && l.air >= MIN_AIR, 'aufgeklappt passt es', 'lowest=' + l.lowest + ' air=' + l.air);
  check(!(l.overlaps || []).length, 'aufgeklappt keine Ueberlappung', JSON.stringify((l.overlaps || []).slice(0, 2)));

  var f = await evP('JSON.stringify(CleanFrameDebug.focus())');
  check(f.action.indexOf('wx.wxStyle') === 0, 'Fokus steht in den Antworten', f.action);

  /* Runter waehlt die naechste Antwort - das ist die Richtung, die die Liste auf
   * dem Bildschirm hat. Frueher klappte sie zu und sprang zur naechsten Frage. */
  await pressP(['down']);
  await sleep(350);
  var g = await evP('JSON.stringify(CleanFrameDebug.focus())');
  check(g.action === 'wx.wxStyle.icon-temp', 'runter waehlt die naechste Antwort', g.action);
  check((await rowsP()).sections[0].open, 'runter laesst die Liste offen');

  await pressP(['up']);
  await sleep(350);
  var g2 = await evP('JSON.stringify(CleanFrameDebug.focus())');
  check(g2.action === 'wx.wxStyle.none', 'hoch waehlt die vorige Antwort', g2.action);

  /* OK auf der schon gueltigen Antwort klappt nur zu. Wichtig: ohne Ort darf das
   * Wetter nicht anspringen, und der Orts-Dialog darf hier nicht aufgehen. */
  await pressP(['ok']);
  await sleep(450);
  var h = await evP('JSON.stringify(CleanFrameDebug.focus())');
  check(h.action === 'pick.wxStyle', 'OK auf der gueltigen Antwort klappt zu', h.action);

  /* Uebernahme an der Zeile "Groesse": unabhaengig vom Ort pruefbar. */
  await pressP(['down']);
  await sleep(300);
  var s1 = await evP('JSON.stringify(CleanFrameDebug.focus())');
  check(s1.action === 'pick.wxSize', 'runter landet auf der naechsten Frage', s1.action);
  await pressP(['ok']);
  await sleep(450);
  await pressP(['down']);
  await sleep(350);
  var hh = await evP('JSON.stringify(CleanFrameDebug.focus())');
  var picked = hh.label;
  await pressP(['ok']);
  /* Das Schreiben laeuft ueber den Hub, die Zeile zeigt den neuen Wert erst
   * danach. Mit festen 600 ms war der Lauf sporadisch rot ("Normal erwartet"). */
  var r4 = (await rowsP()).sections;
  for (var w = 0; w < 25 && r4[1].v !== picked; w++) {
    await sleep(200);
    r4 = (await rowsP()).sections;
  }
  check(!r4[1].open, 'OK uebernimmt und klappt zu');
  check(r4[1].v === picked, 'neuer Wert steht in der Zeile', r4[1].v + ' (erwartet ' + picked + ')');
  check(r4[0].v === first, 'erste Zeile unveraendert', r4[0].v);

  /* Stefan: die Zeile "Wo sie sitzt" zeigte denselben Text wie der Wert darunter
   * ("Right edge" als Frage und als Antwort). Jede Zeile braucht ihren Text. */
  var vals = await evP('(function(){var out=[];var s=document.querySelectorAll(".setting-section .pick-row .setting-name");'
    + 'for(var i=0;i<s.length;i++)out.push(s[i].textContent.trim());return JSON.stringify(out);})()');
  var seen = {}, dup = null;
  vals.forEach(function (v) { if (seen[v]) dup = v; seen[v] = 1; });
  var qs = r4.map(function (x) { return x.q; }), qDup = null, qSeen = {};
  qs.forEach(function (q) { if (qSeen[q]) qDup = q; qSeen[q] = 1; });
  check(qs.length === 5 && !qDup, 'fuenf Fragen, jede nur einmal', JSON.stringify(qs) + (qDup ? ' doppelt: ' + qDup : ''));
  check(vals.length === 4 && !dup, 'vier Auswahl-Zeilen, jede mit eigenem Wert',
    JSON.stringify(vals) + (dup ? ' doppelt: ' + dup : ''));

  var l2 = await layoutP();
  check(l2.fits, 'aufgeklappte Seite passt in die Buehne', 'lowest=' + l2.lowest + ' air=' + l2.air);

  await backP();
  finish();
}
function back(cb) { press(['back'], function () { press(['back'], function () { setTimeout(cb, 400); }); }); }
function finish() {
  if (finished) return;
  finished = true;
  var bad = results.filter(function (r) { return !r.ok; });
  if (consoleErrors.length) {
    console.log('  FEHL  Fehler beim Laden der Seite:');
    consoleErrors.slice(0, 2).forEach(function (e) {
      console.log(e.split('\n').slice(0, 7).map(function (l) { return '        ' + l; }).join('\n'));
    });
  }
  console.log('\nRESULT ' + (results.length - bad.length) + '/' + results.length);
  client.close(); process.exit(bad.length ? 1 : 0);
}
