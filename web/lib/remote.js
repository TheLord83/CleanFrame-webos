/*
 * Fernsteuerung fuer den laufenden Launcher am Fernseher (Screenshot + Tasten).
 *
 * Der Launcher ist eine Chromium-Web-App (webOS). Auf dem Geraet laeuft Chrome
 * DevTools auf Port 9998 — gebunden an 127.0.0.1 und per iptables gesperrt.
 *
 * Warum kein SSH: auf webOS gibt es kein ssh-Binary (nur den Server). Der Server
 * oeffnet die Sperre deshalb selbst fuer die Dauer einer Anfrage und laesst ein
 * Einmal-Forward auf 9998 aufbauen (CF_FORWARD_CMD, auf dem TV z. B.
 * "tcpsvd -v 127.0.0.1"), danach wird die Sperre wieder gesetzt.
 *
 * Nur Bordmittel (node 8): kein WebSocket-Paket, eigener kleiner Client.
 */
'use strict';

var net = require('net');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var DEVTOOLS_PORT = parseInt(process.env.CF_DEVTOOLS_PORT || '9998', 10);
var FORWARD_CMD = process.env.CF_FORWARD_CMD || '';

/* Tasten wie auf der Fernbedienung (webOS keyCodes). */
var KEYS = {
  up: 38, down: 40, left: 37, right: 39, ok: 13, back: 461,
  menu: 457, play: 415, pause: 19, stop: 413, info: 457, exit: 462,
  red: 403, green: 404, yellow: 405, blue: 406,
  num0: 48, num1: 49, num2: 50, num3: 51, num4: 52, num5: 53, num6: 54, num7: 55, num8: 56, num9: 57,
  volup: 447, voldown: 448, chup: 427, chdown: 428
};

function freePort(cb) {
  var srv = net.createServer();
  srv.listen(0, '127.0.0.1', function () {
    var port = srv.address().port;
    srv.close(function () { cb(port); });
  });
  srv.on('error', function () { cb(0); });
}

/* Einmal-Forward auf den DevTools-Port. */
function openForward(cb) {
  if (FORWARD_CMD) {
    freePort(function (port) {
      var parts = FORWARD_CMD.split(' ');
      var bin = parts.shift();
      var args = parts.concat([String(port), 'nc', '127.0.0.1', String(DEVTOOLS_PORT)]);
      var child;
      try { child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'ignore'] }); } catch (e) { return cb(String(e)); }
      cb(null, { port: port, child: child });
    });
    return;
  }
  /* Kein Hilfsprogramm konfiguriert: direkt verbinden. Sinnvoll fuer Tests, in
   * denen der DevTools-Port ohnehin lokal erreichbar ist. */
  cb(null, { port: DEVTOOLS_PORT, child: null, opened: false });
}

function closeForward(f, cb) {
  if (f && f.child) { try { f.child.kill(); } catch (e) {} }
  cb && cb();
}

/* HTTP gegen den Forward (DevTools spricht JSON). Der Antwortkoerper wird als
 * Buffer gesammelt und erst am Ende in Text gewandelt — sonst zerreissen
 * mehrbytige Umlaute. */
function httpLocal(port, pathname, cb) {
  var sock = net.connect({ host: '127.0.0.1', port: port });
  var chunks = [], done = false;
  function finish(err, body) {
    if (done) return;
    done = true;
    try { sock.destroy(); } catch (e) {}
    cb(err, body);
  }
  sock.setTimeout(5000);
  sock.on('connect', function () {
    sock.write('GET ' + pathname + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  });
  sock.on('data', function (c) {
    chunks.push(c);
    /* DevTools haelt die Verbindung offen (kein "end") — deshalb nach
     * Content-Length auswerten, sobald die Kopfzeilen da sind. */
    var raw = Buffer.concat(chunks), idx = raw.indexOf('\r\n\r\n');
    if (idx < 0) return;
    var head = raw.slice(0, idx).toString('latin1');
    if (!/^HTTP\/1\.[01] 200/.test(head)) return finish('DevTools antwortet nicht (' + head.slice(0, 40) + ')');
    var m = /content-length:\s*(\d+)/i.exec(head), need = m ? parseInt(m[1], 10) : 0;
    if (raw.length - (idx + 4) >= need) finish(null, raw.slice(idx + 4).toString('utf8'));
  });
  sock.on('end', function () {
    var raw = Buffer.concat(chunks), idx = raw.indexOf('\r\n\r\n');
    if (idx < 0) return finish('Antwort ohne HTTP-Kopf');
    finish(null, raw.slice(idx + 4).toString('utf8'));
  });
  sock.on('timeout', function () { finish('Zeitueberschreitung'); });
  sock.on('error', function (e) { finish(String(e && e.message || e)); });
}

/* Kleiner WebSocket-Client fuer CDP (nur Textframes). */
function wsConnect(port, wsPath, onMessage, onOpen, onError) {
  var sock = net.connect({ host: '127.0.0.1', port: port });
  var buf = Buffer.alloc(0), handshaken = false;
  sock.on('connect', function () {
    sock.write('GET ' + wsPath + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') +
      '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  sock.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!handshaken) {
      var idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      handshaken = true;
      buf = buf.slice(idx + 4);
      onOpen();
    }
    while (buf.length >= 2) {
      var len = buf[1] & 127, offset = 2;
      if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
      /* node 8 kennt readBigUInt64BE nicht — 64 Bit von Hand aus zwei 32-Bit-Werten. */
      else if (len === 127) { len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); offset = 10; }
      if (buf[1] & 128) offset += 4;
      if (buf.length < offset + len) return;
      onMessage(buf.slice(offset, offset + len).toString('utf8'));  /* Textframes: UTF-8 */
      buf = buf.slice(offset + len);
    }
  });
  sock.on('error', function (e) { if (onError) onError(String(e && e.message || e)); });
  function head(len) {
    if (len < 126) return Buffer.from([0x81, 0x80 | len]);
    if (len < 65536) { var h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); return h; }
    var h2 = Buffer.alloc(10); h2[0] = 0x81; h2[1] = 0x80 | 127; h2.writeUInt32BE(0, 2); h2.writeUInt32BE(len, 6); return h2;
  }
  return {
    send: function (obj) {
      var data = Buffer.from(JSON.stringify(obj));
      var mask = crypto.randomBytes(4), masked = Buffer.alloc(data.length), i;
      for (i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
      sock.write(Buffer.concat([head(data.length), mask, masked]));
    },
    close: function () { try { sock.destroy(); } catch (e) {} }
  };
}

function findLauncher(port, cb) {
  httpLocal(port, '/json/list', function (err, body) {
    if (err) return cb(err);
    var list;
    try { list = JSON.parse(body); } catch (e) {
      try { list = JSON.parse(body.slice(0, body.lastIndexOf(']') + 1)); } catch (e2) { return cb('Ziel-Liste unlesbar'); }
    }
    var hit = null;
    list.forEach(function (t) {
      if (t.type === 'page' && String(t.url).indexOf('com.blackpearl.cleanframe') >= 0) hit = t;
    });
    if (!hit) list.forEach(function (t) { if (!hit && t.type === 'page') hit = t; });
    if (!hit) return cb('Launcher laeuft nicht (keine Seite gefunden).');
    cb(null, hit);
  });
}

function withPage(fn, cb) {
  openForward(function (err, forward) {
    if (err) return cb(err);
    findLauncher(forward.port, function (e2, page) {
      if (e2) { closeForward(forward, function () { cb(e2); }); return; }
      fn(forward.port, page, function (e3, a, b) {
        closeForward(forward, function () { cb(e3, a, b); });
      });
    });
  });
}

function snapshot(opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  opts = opts || {};
  var mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  var params = { format: opts.format === 'png' ? 'png' : 'jpeg' };
  if (params.format === 'jpeg') params.quality = Math.max(30, Math.min(90, parseInt(opts.quality, 10) || 65));
  if (opts.maxWidth) params.clip = { x: 0, y: 0, width: opts.maxWidth, height: opts.maxHeight || 1080, scale: opts.scale || 1 };
  withPage(function (port, page, done) {
    var finished = false;
    function finish(err, a, b) { if (finished) return; finished = true; done(err, a, b); }
    var ws = wsConnect(port, page.webSocketDebuggerUrl.replace(/^ws:\/\/[^\/]+/, ''), function (raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.id === 1) {
        if (msg.result && msg.result.data) finish(null, msg.result.data, mime);
        else finish('Kein Bild erhalten');
        ws.close();
      }
    }, function () {
      ws.send({ id: 1, method: 'Page.captureScreenshot', params: params });
    }, function (e) { finish('CDP: ' + e); });
    setTimeout(function () { try { ws.close(); } catch (e) {} finish('Zeitueberschreitung beim Bild'); }, 6000);
  }, cb);
}

/* names: Liste von Tastennamen. opts.holdMs: Taste so lange gedrueckt halten
 * (fuer Langdruck, z. B. OK 900 ms) — sonst 90 ms wie ein kurzer Druck. */
function sendKeys(names, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  opts = opts || {};
  var holdMs = Math.max(0, Math.min(4000, parseInt(opts.holdMs, 10) || 0));
  var codes = [];
  (names || []).forEach(function (n) {
    if (KEYS[n] !== undefined) codes.push({ code: KEYS[n], key: n });
    else if (/^\d+$/.test(String(n))) codes.push({ code: parseInt(n, 10), key: String(n) });
  });
  if (!codes.length) return cb('keine gueltigen Tasten');
  withPage(function (port, page, done) {
    var id = 0, finished = false;
    function finish(err, a) { if (finished) return; finished = true; done(err, a); }
    var ws = wsConnect(port, page.webSocketDebuggerUrl.replace(/^ws:\/\/[^\/]+/, ''), function () {}, function () {
      (function next(i) {
        if (i >= codes.length) {
          setTimeout(function () { ws.close(); finish(null, codes.map(function (c) { return c.key; })); }, 200);
          return;
        }
        var c = codes[i], keyName = String.fromCharCode(c.code);
        if (c.code === 13) keyName = 'Enter';
        if (c.code === 37) keyName = 'ArrowLeft';
        if (c.code === 38) keyName = 'ArrowUp';
        if (c.code === 39) keyName = 'ArrowRight';
        if (c.code === 40) keyName = 'ArrowDown';
        if (c.code === 461) keyName = 'Backspace';
        /* Langdruck gilt fuer die letzte Taste, wenn holdMs gesetzt ist. */
        var downFor = (holdMs && i === codes.length - 1) ? holdMs : 90;
        ws.send({ id: ++id, method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', key: keyName, windowsVirtualKeyCode: c.code, nativeVirtualKeyCode: c.code } });
        setTimeout(function () {
          ws.send({ id: ++id, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: keyName, windowsVirtualKeyCode: c.code, nativeVirtualKeyCode: c.code } });
          setTimeout(function () { next(i + 1); }, 180);
        }, downFor);
      }(0));
    }, function (e) { finish('CDP: ' + e); });
    setTimeout(function () { try { ws.close(); } catch (e) {} finish('Zeitueberschreitung beim Senden'); }, 9000 + holdMs);
  }, cb);
}

/* Ansichten, die die Weboberflaeche am Fernseher anzeigen kann. Die App
 * bietet dafuer bereits window.CleanFrameDebug (openSettings/closeAll) an -
 * damit laesst sich die Ansicht gezielt setzen, statt Tastenfolgen zu raten. */
var VIEWS = {
  home: 'window.CleanFrameDebug && CleanFrameDebug.closeAll()',
  settings: 'window.CleanFrameDebug && CleanFrameDebug.openSettings()',
  appearance: "window.CleanFrameDebug && CleanFrameDebug.openSettings('background')"
};

/* Wertet einen Ausdruck im Launcher aus (Runtime.evaluate, returnByValue) und
 * gibt das Ergebnis zurueck. */
function evaluate(expression, cb) {
  var expr = String(expression || '');
  if (!expr) return cb('leerer Ausdruck');
  withPage(function (port, page, done) {
    var finished = false;
    function finish(err, a) { if (finished) return; finished = true; done(err, a); }
    var ws = wsConnect(port, page.webSocketDebuggerUrl.replace(/^ws:\/\/[^\/]+/, ''), function (raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.id !== 1) return;
      if (msg.result && msg.result.exceptionDetails) {
        var ex = msg.result.exceptionDetails;
        finish('Launcher meldet: ' + ((ex.exception && ex.exception.description) || ex.text || 'Fehler'));
        ws.close();
        return;
      }
      var res = msg.result && msg.result.result;
      finish(null, res && res.value !== undefined ? res.value : null);
      ws.close();
    }, function () {
      ws.send({ id: 1, method: 'Runtime.evaluate',
                params: { expression: expr, returnByValue: true, awaitPromise: false } });
    }, function (e) { finish('CDP: ' + e); });
    setTimeout(function () { try { ws.close(); } catch (e) {} finish('Zeitueberschreitung beim Umschalten'); }, 6000);
  }, cb);
}

module.exports = { snapshot: snapshot, sendKeys: sendKeys, evaluate: evaluate, KEYS: KEYS, VIEWS: VIEWS };
