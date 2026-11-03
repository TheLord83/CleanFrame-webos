/* Ist jede Auswahlzeile entweder eine Picker-Zeile oder ausdruecklich eine Aktion?
 *
 *   node tools/test-settings-rows.js --port 9333           # Stand pruefen
 *   node tools/test-settings-rows.js --port 9333 --report  # zusaetzlich: was noch Picker werden muss
 *
 * Warum: die Einstellungen hatten zwei Bedienmuster — aufgeklappte Auswahl (picker)
 * und Knopfreihen. Stefan hat am Wetter genau darueber gestolpert. Ein Test, der nur
 * eine feste Liste abarbeitet, faengt eine NEUE Zeile nie; deshalb liest dieser Test
 * die Zeilen aus der geoeffneten Seite und vergleicht sie mit der Erwartung:
 *
 *   - Zeile auf der Seite, die die Erwartung nicht kennt  -> Fehler (neu oder umbenannt)
 *   - Zeile in der Erwartung, die auf der Seite fehlt     -> Fehler (entfernt)
 *   - Aufbau passt nicht (picker/choice/action, Anzahl Antworten) -> Fehler
 *
 * Die Erwartung ist der Stand von 0.6.32. `want` ist das Ziel: alle Auswahlzeilen
 * als Picker, Aktionen (oeffnen etwas) bleiben. Was noch `choice` ist und `want:
 * 'picker'` hat, steht mit --report als Umbau-Liste da. Bei der Migration in 0.6.33
 * wird je Zeile `kind` auf `picker` gesetzt — dann ist der Test der Waechter.
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var PORT = (function () { var i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 9333; })();
var REPORT = process.argv.indexOf('--report') >= 0;

/* Aufbau: picker = eine Zeile, die ihren Wert zeigt und die Antworten aufklappt.
 * choice = Knopfreihe in der Zeile. action = genau ein Knopf, der etwas oeffnet.
 * opts = Anzahl Antworten; null heisst "wechselt" (die Schriftliste haengt an den
 * privaten Schriften), dort wird nur "mindestens eine" geprueft.
 */
var EXPECT = {
  'settings.group.background': [
    { q: 'Background type', kind: 'choice', opts: 3, want: 'picker' },
    { q: 'Wallpaper', kind: 'action', opts: 1, want: 'action' },
    { q: 'Rotation', kind: 'action', opts: 1, want: 'action' }
  ],
  'settings.group.layout': [
    { q: 'Layout', kind: 'picker', opts: 2, want: 'picker' },
    { q: 'App display', kind: 'picker', opts: 3, want: 'picker' },
    { q: 'Home controls', kind: 'picker', opts: 3, want: 'picker' }
  ],
  'settings.group.typography': [
    { q: 'Font', kind: 'choice', opts: null, want: 'picker' },
    { q: 'Text size', kind: 'picker', opts: 8, want: 'picker' }
  ],
  /* "Text size" in der Uebersicht oeffnet dieselbe Seite wie "Typography". */
  'settings.group.text': [
    { q: 'Font', kind: 'choice', opts: null, want: 'picker' },
    { q: 'Text size', kind: 'picker', opts: 8, want: 'picker' }
  ],
  'settings.group.focus': [
    { q: 'Focus style', kind: 'choice', opts: 2, want: 'picker' },
    { q: 'Material', kind: 'choice', opts: 3, want: 'picker' }
  ],
  'settings.group.clocklang': [
    { q: 'Clock', kind: 'choice', opts: 3, want: 'picker' },
    { q: 'Language', kind: 'choice', opts: 3, want: 'picker' }
  ],
  'settings.group.weather': [
    { q: 'Shown as', kind: 'picker', opts: 5, want: 'picker' },
    { q: 'Size', kind: 'picker', opts: 3, want: 'picker' },
    { q: 'Where it sits', kind: 'picker', opts: 4, want: 'picker' },
    { q: 'Distance from the clock', kind: 'picker', opts: 4, want: 'picker' },
    { q: 'Place', kind: 'action', opts: 1, want: 'action' }
  ],
  /* LG-Menue: eine Zeile mit zwei Knoepfen, beide oeffnen etwas (LG Home bzw. die
   * TV-Einstellungen). Sie bleibt eine Knopfreihe — sie ist keine Auswahl. */
  'settings.group.samsung': [
    { q: 'LG', kind: 'choice', opts: 2, want: 'choice' }
  ]
};

/* Zeilen der Uebersicht, die keine Abschnittsseite oeffnen, sondern etwas anderes
 * (Editor, Werte-Liste, Einrichtung, LG-Menue). Dort wird nur geprueft, dass OK
 * ueberhaupt etwas oeffnet — der Inhalt dieser Seiten ist nicht Teil dieses Tests. */
var OPENS = ['settings.editor', 'settings.group.ent', 'settings.group.setup'];

var results = [], finished = false, migration = [];

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
var client, id = 0, waiting = {}, consoleErrors = [];
function send(me, pa, cb) { var n = ++id; waiting[n] = cb || function () {}; client.send({ id: n, method: me, params: pa || {} }); }
function js(e, cb) {
  send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
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
function P(fn) {
  return function () {
    var a = Array.prototype.slice.call(arguments);
    return new Promise(function (res) { a.push(function (v) { res(v); }); fn.apply(null, a); });
  };
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var evP = P(ev), pressP = P(press), focusP = P(focus), check2;
/* Eine Antwort kommt als JSON-Text oder schon als Wert zurueck (returnByValue);
 * beides annehmen, statt an einem Aufruf zu scheitern, der ein Objekt liefert. */
function ev(e, cb) {
  js(e, function (v) {
    if (typeof v !== 'string') return cb(v);
    try { cb(JSON.parse(v)); } catch (err) { cb(v); }
  });
}
function press(keys, cb) { ev('JSON.stringify(CleanFrameDebug.press(' + JSON.stringify(keys) + '))', cb); }
function focus(cb) { ev('JSON.stringify(CleanFrameDebug.focus())', cb); }
function check(ok, name, note) {
  results.push({ ok: ok, name: name });
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
}

/* Die Zeilen der geoeffneten Seite: Aufbau je Abschnitt, nicht die Ueberschrift —
 * die ist uebersetzt und taugt nicht als Schluessel. */
function sections(cb) {
  ev('(function(){var out=[],s=document.querySelectorAll(".setting-section");' +
     'for(var i=0;i<s.length;i++){var sec=s[i],l=sec.querySelector(".setting-label"),' +
     'pick=!!sec.querySelector(".pick-row"),' +
     'opts=sec.querySelectorAll((pick?".picker-list":".setting-options")+" .setting-choice").length;' +
     'var disabled=sec.querySelectorAll(".setting-choice.is-disabled").length;' +
     'var m=/(?:^| )section-([A-Za-z0-9-]+)(?: |$)/.exec(sec.className);' +
     'out.push({q:l?l.textContent.trim():"",id:m?m[1]:"",picker:pick,opts:opts,disabled:disabled});}' +
     'return JSON.stringify(out);})()', cb);
}
function view(cb) { ev('JSON.stringify(CleanFrameDebug.focus())', cb); }

/* Die Antworten einer Picker-Zeile stehen erst im DOM, wenn die Zeile offen ist
 * (der geschlossene Kopf enthaelt sie nicht). Also aufklappen, zaehlen, zuklappen —
 * und dabei gleich pruefen, dass ueberhaupt etwas aufgeht. */
async function openCount() {
  await pressP(['ok']);
  await sleep(450);
  var open = await new Promise(function (res) {
    ev('JSON.stringify((function(){var s=document.querySelector(".setting-section.is-open");' +
       'if(!s)return null;var l=s.querySelector(".setting-label");' +
       'return {q:l?l.textContent.trim():"",opts:s.querySelectorAll(".picker-list .setting-choice").length};})())', res);
  });
  await pressP(['ok']);
  await sleep(400);
  return open;
}

function toSettings(cb, tries) {
  tries = tries || 0;
  if (tries > 24) return cb(false);
  view(function (f) {
    if (f.view === 'settings') return cb(true);
    if (f.view === 'message') return press(['ok'], function () { toSettings(cb, tries + 1); });
    if (f.view !== 'home') return press(['back'], function () { toSettings(cb, tries + 1); });
    press(['down'], function () { press(['ok'], function () { toSettings(cb, tries + 1); }); });
  });
}
/* In der zweispaltigen Uebersicht zur Zeile: runter bis zum Ende, dann rechts,
 * und zwischendurch hoch — dieselbe Suche wie in test-picker.js. */
/* Zur Zeile in der zweispaltigen Uebersicht. Die Liste ist nicht so einfach, wie
 * sie aussieht (gemessen, nicht vermutet): "runter" laeuft durch alle Eintraege,
 * "hoch" bleibt aber am oberen Rand der ZWEITEN Spalte stehen — ab dem siebten
 * Eintrag geht es nur mit "links" weiter nach oben. Deshalb: ganz nach unten,
 * links in die erste Spalte, dort nach oben, dann runter bis zur gesuchten Zeile. */
async function goTo(action) {
  var f = await focusP();
  if (f.view !== 'settings') return false;
  if (f.action === action) return true;
  var i, before, g;
  /* 1. nach unten bis es nicht weitergeht */
  for (i = 0; i < 16; i++) {
    before = f.action;
    await pressP(['down']); await sleep(180);
    f = await focusP();
    if (f.action === before) break;
    if (f.action === action) return true;
  }
  /* 2./3. in die erste Spalte und nach oben. "column" steht in der Uebersicht nicht
   * im Zustand, deshalb hilft nur: links druecken (in Spalte 0 wirkungslos) und
   * hoch, solange sich etwas bewegt — hoechstens dreimal, dann ist der Anfang
   * erreicht. */
  for (var k = 0; k < 3; k++) {
    await pressP(['left']); await sleep(150);
    f = await focusP();
    var moved = false;
    for (i = 0; i < 16; i++) {
      before = f.action;
      await pressP(['up']); await sleep(150);
      f = await focusP();
      if (f.action === before) break;
      moved = true;
    }
    if (!moved) break;
  }
  /* 4. runter bis zur gesuchten Zeile */
  for (i = 0; i < 16; i++) {
    if (f.action === action) return true;
    before = f.action;
    await pressP(['down']); await sleep(180);
    f = await focusP();
    if (f.action === before) break;
  }
  return f.action === action;
}

/* Innerhalb einer Seite: eine Picker-Zeile erkennt man am Fokus "pick.<id>".
 * Ueber die Zeilennummer zu gehen war falsch: eine Knopfreihe belegt je Antwort
 * eine Zeile, die naechste Zeile liegt also nicht bei i+1 (gemessen an der
 * Typografie-Seite: Schriftart belegt Zeilen 1-3, Schriftgroesse sitzt auf 4). */
async function focusPicker(id) {
  var f = await focusP();
  var ziel = 'pick.' + id;
  for (var i = 0; i < 16; i++) {
    if (f.action === ziel) return f;
    var before = f.action;
    await pressP(['up']); await sleep(200);
    var g = await focusP();
    if (g.action === before) break;
    f = g;
  }
  for (var j = 0; j < 20; j++) {
    if (f.action === ziel) return f;
    var vorher = f.action;
    await pressP(['down']); await sleep(200);
    var h = await focusP();
    if (h.action === vorher) break;
    f = h;
  }
  return f.action === ziel ? f : null;
}
async function openPage(action) {
  if (!(await new Promise(function (res) { toSettings(res); }))) return false;
  var found = await goTo(action);
  if (!found) return false;
  await pressP(['ok']);
  await sleep(700);
  return true;
}
async function backToList() {
  await pressP(['back']);
  await sleep(500);
  var f = await focusP();
  if (f.view !== 'settings') { await new Promise(function (res) { toSettings(res); }); }
}

async function run() {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: PAGE });
  var ready = false;
  for (var i = 0; i < 60 && !ready; i++) {
    await sleep(250);
    ready = (await new Promise(function (res) {
      js('typeof CleanFrameDebug', function (v) { res(v === 'object'); });
    }));
  }
  if (!ready) { console.log('  FEHL  Seite wurde nicht fertig geladen'); return finish(); }

  var pages = Object.keys(EXPECT);
  await checkPages(pages);
  await checkOpens();
  finish();
}

async function checkPages(pages) {
  for (var p = 0; p < pages.length; p++) {
    var action = pages[p], expect = EXPECT[action];
    if (!(await openPage(action))) {
      var wo = await focusP();
      check(false, action + ': Seite erreichbar', 'view=' + wo.view + ' action=' + wo.action);
      continue;
    }
    var f = await focusP();
    var got = await new Promise(function (res) { sections(res); });
    /* ev() liefert schon den Wert; nur wenn eine Seite JSON-Text schickt, wird
     * hier geparst — zweimal parsen war der Grund fuer "Unexpected token o". */
    if (typeof got === 'string') got = JSON.parse(got || '[]');
    if (!got) got = [];
    var label = action.replace('settings.group.', '');

    /* Zeile fuer Zeile: Position ist der Schluessel, die Ueberschrift nur Beiwerk. */
    check(got.length === expect.length, label + ': Zeilenzahl',
      got.length + ' auf der Seite, ' + expect.length + ' erwartet');
    for (var i = 0; i < Math.min(got.length, expect.length); i++) {
      var g = got[i], e = expect[i], name = label + ' [' + (i + 1) + '] ' + (g.q || e.q);
      var kind = g.picker ? 'picker' : (g.opts === 1 ? 'action' : 'choice');
      check(kind === e.kind, name + ': Aufbau', kind + ' statt ' + e.kind);
      if (kind === 'picker') {
        var placed = await focusPicker(g.id);
        check(!!placed, name + ': Zeile ist erreichbar');
        var opened = await openCount();
        var count = opened ? opened.opts : 0;
        check(!!opened, name + ': OK klappt die Antworten auf');
        if (e.opts === null) check(count >= 1, name + ': mindestens eine Antwort', 'opts=' + count);
        else check(count === e.opts, name + ': Anzahl Antworten', count + ' statt ' + e.opts);
        check(count > 1, name + ': Picker hat mehr als eine Antwort', 'opts=' + count);
      } else if (e.opts === null) {
        check(g.opts >= 1, name + ': mindestens eine Antwort', 'opts=' + g.opts);
      } else {
        check(g.opts === e.opts, name + ': Anzahl Antworten', g.opts + ' statt ' + e.opts);
      }
      if (e.kind === 'choice' && e.want === 'picker') {
        migration.push(action.replace('settings.group.', '') + ' [' + (i + 1) + '] ' + (g.q || e.q));
      }
    }
    /* Eine Zeile, die die Erwartung nicht kennt, ist der Fall, der die
     * Inkonsistenz von 0.6.32 verursacht hat: sie faellt sonst nie auf. */
    if (got.length > expect.length) {
      var extra = got.slice(expect.length).map(function (x) { return x.q || '(ohne Titel)'; });
      check(false, label + ': jede Zeile ist bekannt', 'neu: ' + extra.join(', '));
    }
    check(f.view !== 'settings', label + ': Seite wurde geoeffnet', 'view=' + f.view);
    await backToList();
  }
}

async function checkOpens() {
  for (var i = 0; i < OPENS.length; i++) {
    var action = OPENS[i];
    if (!(await openPage(action))) {
      var wo2 = await focusP();
      check(false, action + ': Zeile erreichbar', 'view=' + wo2.view + ' action=' + wo2.action);
      continue;
    }
    var f = await focusP();
    check(f.view !== 'settings', action + ': OK oeffnet etwas', 'view=' + f.view);
    await backToList();
  }
}

http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
  var b = '';
  res.on('data', function (c) { b += c; });
  res.on('end', function () {
    var pages = JSON.parse(b).filter(function (t) { return t.type === 'page'; });
    if (!pages.length) { console.log('  FEHL  kein Tab auf Port ' + PORT); return finish(); }
    client = wsConnect(pages[0].webSocketDebuggerUrl, function (raw) {
      var m = JSON.parse(raw);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; return; }
      if (m.method && client.onEvent) client.onEvent(m);
    }, function () {
      client.onEvent = function (m) {
        if (m.method !== 'Runtime.exceptionThrown') return;
        var d = (m.params && m.params.exceptionDetails) || {};
        consoleErrors.push((d.exception && d.exception.description) || d.text || 'Fehler');
      };
      run().catch(function (e) { console.log('  FEHL  Lauf abgebrochen: ' + e.message); console.log((e.stack||'').split('\n').slice(0,6).join('\n')); finish(); });
    });
  });
});

function finish() {
  if (finished) return;
  finished = true;
  if (REPORT && migration.length) {
    console.log('\n  Umbau auf Picker (0.6.33):');
    migration.forEach(function (m) { console.log('    ' + m); });
  }
  if (consoleErrors.length) {
    console.log('  FEHL  Fehler beim Laden der Seite:');
    consoleErrors.slice(0, 2).forEach(function (e) {
      console.log(e.split('\n').slice(0, 7).map(function (l) { return '        ' + l; }).join('\n'));
    });
  }
  var bad = results.filter(function (r) { return !r.ok; });
  console.log('\nRESULT ' + (results.length - bad.length) + '/' + results.length);
  if (client) client.close();
  process.exit(bad.length ? 1 : 0);
}
