#!/usr/bin/env node
/* Der QR-Code der Einrichtung: Adresse, Matrix, und dass das Bild lesbar ist.

   Der Code zeigt auf die Hub-Seite im Netz, also auf die Adresse des
   Fernsehers. Zwei Zusagen werden geprueft, die beide schon gebrochen waren:

   1. Die Adresse ist eine LAN-Adresse des Geraets - kein DNS-Name (den gibt es
      nicht in jedem Netz) und kein 127.0.0.1 (das ist auf dem Handy der Handy).
   2. Die Matrix entsteht im Geraet, und ihre Struktur stimmt: Suchermarken in
      drei Ecken, Taktmuster, Groesse passt zur QR-Version. Frueher lag eine
      fertige Matrix im Paket, gerechnet beim Bauen auf einen fremden Namen.

   Der Beweis, dass das Bild auch gelesen wird, kommt von einem unabhaengigen
   Decoder (zxing-cpp, ueber tools/qr-decode.py). Fehlt der auf dieser Maschine,
   steht dort SKIP - die Strukturpruefungen laufen trotzdem.

   Aufruf: node tools/test-setup-qr.js --port 9333 [--tv-ip 192.168.0.49]
*/
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var args = process.argv.slice(2);
function opt(name, fallback) {
  var i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
var PORT = Number(opt('port', 9333));
var TV_IP = opt('tv-ip', '192.168.0.49');
var APP = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var ROOT = path.resolve(__dirname, '..');

var passed = 0, failed = 0, skipped = 0;
function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}
function skip(what, why) { skipped++; console.log('  SKIP  ' + what + '   ' + why); }

function cdp() {
  return new Promise(function (resolve, reject) {
    var req = http.request('http://127.0.0.1:' + PORT + '/json/list', function (res) {
      var buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve([]); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/* Suchermarke: 7x7 mit dunklem Ring, hellem Ring, dunklem Kern. */
function finderAt(rows, ox, oy) {
  for (var y = 0; y < 7; y++) {
    for (var x = 0; x < 7; x++) {
      var ring = (x === 0 || x === 6 || y === 0 || y === 6);
      var core = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      var want = (ring || core) ? '1' : '0';
      if (rows[oy + y].charAt(ox + x) !== want) return false;
    }
  }
  return true;
}

async function main() {
  /* 1. Statisch: das Paket enthaelt einen Encoder, keine fertige Matrix. */
  var html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  check(/assets\/qrcode\.js/.test(html), 'index.html laedt den Encoder');
  check(!/assets\/qr-setup\.js/.test(html), 'keine fertige Matrix mehr im Paket');
  var vendored = fs.readFileSync(path.join(ROOT, 'app', 'assets', 'qrcode.js'), 'utf8');
  check(/MIT license/i.test(vendored) && /Kazuhiko Arase/.test(vendored),
    'der Encoder traegt Herkunft und Lizenz');

  var targets = await cdp();
  var pages = (Array.isArray(targets) ? targets : []).filter(function (t) { return t.type === 'page'; });
  var page = pages.filter(function (t) { return /^http/.test(t.url); })[0] || pages[0];
  if (!page) throw new Error('kein Tab am Pruefstand (Port ' + PORT + ')');

  var ws = new WebSocket(page.webSocketDebuggerUrl);
  var id = 0, waiting = {};
  ws.addEventListener('message', function (ev) {
    var msg = JSON.parse(ev.data);
    if (msg.id && waiting[msg.id]) { waiting[msg.id](msg.result); delete waiting[msg.id]; }
  });
  await new Promise(function (r) { ws.addEventListener('open', r); });
  function send(method, params) {
    return new Promise(function (resolve) {
      var n = ++id;
      waiting[n] = resolve;
      ws.send(JSON.stringify({ id: n, method: method, params: params || {} }));
    });
  }
  async function evaluate(expression) {
    var r = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || 'JS-Fehler');
    return r && r.result ? r.result.value : undefined;
  }

  await send('Page.enable');
  await send('Page.navigate', { url: APP });
  var ready = false;
  for (var i = 0; i < 80 && !ready; i++) {
    await new Promise(function (r) { setTimeout(r, 150); });
    ready = await evaluate('!!(window.CleanFrameDebug && window.CleanFrameDebug.ready && window.CleanFrameDebug.ready())');
  }
  check(ready, 'App ist geladen');
  if (!ready) { ws.close(); process.exit(1); }

  /* 2. Mit LAN-Adresse: URL, Matrix, Struktur. */
  var q = await evaluate('window.CleanFrameDebug.setupQr(' + JSON.stringify(TV_IP) + ')');
  check(q && q.url === 'http://' + TV_IP + ':8484/', 'die Adresse ist http://<ip>:8484/',
    q && q.url);
  check(q && q.fidelity === 'matrix', 'die Matrix entsteht im Geraet', q && q.fidelity);
  var rows = (q && q.rows) || [];
  var n = rows.length;
  check(n >= 21 && (n - 17) % 4 === 0, 'Groesse passt zu einer QR-Version', 'size=' + n);
  check(rows.every(function (r) { return r.length === n; }), 'die Matrix ist quadratisch');
  if (n >= 21) {
    check(finderAt(rows, 0, 0) && finderAt(rows, n - 7, 0) && finderAt(rows, 0, n - 7),
      'Suchermarken in drei Ecken');
    var timing = true;
    for (var t = 8; t < n - 8; t++) {
      if (rows[6].charAt(t) !== (t % 2 === 0 ? '1' : '0')) timing = false;
    }
    check(timing, 'Taktmuster in Zeile 6');
  }
  var svg = (q && q.svg) || '';
  check(/viewBox="0 0 (\d+) \1"/.test(svg) && Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) === n + 4,
    'das Bild zeichnet die Ruhezone mit', svg ? svg.slice(0, 60) : 'kein SVG');
  check(/class="msg-qr-url"/.test(svg) && svg.indexOf(q.url) > 0, 'die Adresse steht unter dem Code');

  /* 3. Ohne Adresse: kein Code, und das wird gesagt. */
  var none = await evaluate('window.CleanFrameDebug.setupQr("")');
  check(none && none.url === '' && none.rows.length === 0, 'ohne Adresse kein Code', JSON.stringify(none && none.url));
  var loop = await evaluate('window.CleanFrameDebug.setupQr("127.0.0.1")');
  check(loop && loop.url === '', 'Loopback wird nicht als Adresse genommen', loop && loop.url);

  /* 4. Unabhaengiger Decoder: enthaelt das Bild wirklich die Adresse? */
  /* Der Decoder braucht zxing-cpp und numpy. Fehlen sie im Standard-Python,
   * laesst sich mit CF_PYTHON ein Interpreter mitgeben, der sie hat. */
  var probe = cp.spawnSync(process.env.CF_PYTHON || 'python3', [path.join(ROOT, 'tools', 'qr-decode.py')], {
    input: JSON.stringify({ rows: rows, expect: 'http://' + TV_IP + ':8484/' }), encoding: 'utf8'
  });
  var out = (probe.stdout || '').trim();
  var decodeMissing = false;
  if (probe.status === 0 && /^DECODED /.test(out)) {
    var got = out.slice('DECODED '.length);
    check(got === 'http://' + TV_IP + ':8484/', 'ein fremder Decoder liest die Adresse', got);
  } else if (probe.status === 2) {
    /* Ohne Decoder bleibt die wichtigste Zusage ungeprueft. Das wird nicht als
     * "passed mit einer Pruefung weniger" verbucht, sondern als Skip der ganzen
     * Stufe - sonst sieht die Zusammenfassung gruen aus, wo etwas fehlt. */
    decodeMissing = true;
    console.log('  SKIP  ein fremder Decoder liest die Adresse   ' + (out || 'Decoder fehlt'));
  } else {
    check(false, 'ein fremder Decoder liest die Adresse', (probe.stderr || out || 'kein Ergebnis').slice(0, 120));
  }

  ws.close();
  if (decodeMissing) {
    console.log('SKIP zxing-cpp/numpy fehlen (pip install zxing-cpp numpy, oder CF_PYTHON setzen)');
    console.log('RESULT 0/0 skip');
    process.exit(2);
  }
  console.log('RESULT ' + passed + '/' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('FEHLER ' + e.message); process.exit(1); });
