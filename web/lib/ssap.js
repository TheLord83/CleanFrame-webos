/*
 * Own remote-control channel to the TV — no Home Assistant, no second app.
 *
 * This is the same route every webOS remote app uses:
 *   1. connect to the SSAP port (3000, plain websocket)
 *   2. `register` with a client key; on the first run the TV asks once on screen
 *   3. ask for the pointer input socket and send `{"type":"button","name":"ENTER"}` frames
 *
 * The key is stored next to the configuration (mode 0600) and reused afterwards, so the
 * on-screen question appears exactly once per TV.
 *
 * Stock node 8 only (the TV runs node 8.12): no WebSocket package, no BigInt.
 */
'use strict';

var net = require('net');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var SSAP_PORT = parseInt(process.env.CF_SSAP_PORT || '3000', 10);
var KEY_FILE = process.env.CF_TV_KEY || '/var/lib/cleanframe/tv-client-key.json';

var MANIFEST = {
  manifestVersion: 1,
  appVersion: '1.0',
  signed: {
    created: '20140509',
    appId: 'com.lge.test',
    vendorId: 'com.lge',
    localizedAppNames: { '': 'CleanFrame' },
    permissions: [
      'TEST_SECURE', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD',
      'READ_INSTALLED_APPS', 'READ_INPUT_DEVICE_LIST', 'READ_TV_CURRENT_TIME',
      'READ_POWER_STATE', 'CONTROL_POWER'
    ]
  }
};

/* Our key names -> button names of the remote control. */
var BUTTONS = {
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', ok: 'ENTER',
  back: 'BACK', menu: 'MENU', exit: 'EXIT', info: 'INFO', home: 'HOME',
  play: 'PLAY', pause: 'PAUSE', stop: 'STOP', mute: 'MUTE',
  volup: 'VOLUMEUP', voldown: 'VOLUMEDOWN',
  chup: 'CHANNELUP', chdown: 'CHANNELDOWN',
  red: 'RED', green: 'GREEN', yellow: 'YELLOW', blue: 'BLUE',
  num0: '0', num1: '1', num2: '2', num3: '3', num4: '4',
  num5: '5', num6: '6', num7: '7', num8: '8', num9: '9'
};

function buttonName(key) {
  if (BUTTONS[key]) return BUTTONS[key];
  if (/^[0-9]$/.test(String(key))) return String(key);
  return '';
}

/* ---------- key storage ---------- */

function readKey() {
  try {
    var raw = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    return raw && raw.key ? raw : null;
  } catch (e) {
    return null;
  }
}

function writeKey(obj) {
  var dir = path.dirname(KEY_FILE);
  try { fs.mkdirSync(dir, 0o755); } catch (e) { /* exists */ }
  fs.writeFileSync(KEY_FILE, JSON.stringify(obj), { mode: 0o600 });
}

/* ---------- minimal websocket client ---------- */

function Ws(sock) {
  this.s = sock;
  this.buf = Buffer.alloc(0);
}

Ws.connect = function (host, port, cb) {
  var sock = net.connect(port, host);
  var key = crypto.randomBytes(16).toString('base64');
  sock.setNoDelay(true);
  sock.on('connect', function () {
    sock.write('GET / HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  var head = Buffer.alloc(0);
  var done = false;
  sock.on('data', function onHandshake(chunk) {
    head = Buffer.concat([head, chunk]);
    var end = head.indexOf('\r\n\r\n');
    if (end < 0) return;
    var status = head.slice(0, head.indexOf('\r\n')).toString('latin1');
    if (status.indexOf('101') < 0) {
      sock.removeListener('data', onHandshake);
      sock.destroy();
      return cb('SSAP lehnt ab: ' + status);
    }
    done = true;
    sock.removeListener('data', onHandshake);
    var ws = new Ws(sock);
    ws.buf = head.slice(end + 4);
    cb(null, ws);
  });
  sock.on('error', function (e) { if (!done) cb(e.code || String(e)); });
  sock.setTimeout(8000, function () { if (!done) { sock.destroy(); cb('timeout'); } });
};

Ws.prototype.send = function (obj) {
  var data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  var header;
  var mask = crypto.randomBytes(4);
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(data.length, 6);
  }
  var masked = Buffer.alloc(data.length);
  for (var i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  this.s.write(Buffer.concat([header, mask, masked]));
};

/* Returns one text frame; keeps leftover bytes for the next call. */
/* Antwortet auf ein Ping-Rahmen des Servers. Ohne Pong schließt der Fernseher die
 * Verbindung nach knapp 40 Sekunden — mitten in der Kopplungsfrage. */
Ws.prototype.pong = function (payload) {
  var data = payload || Buffer.alloc(0);
  var mask = crypto.randomBytes(4);
  var head = Buffer.from([0x8a, 0x80 | data.length]);
  var masked = Buffer.alloc(data.length);
  for (var i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  this.s.write(Buffer.concat([head, mask, masked]));
};

Ws.prototype.recv = function (cb, timeoutMs) {
  var self = this;
  if (self.dead) return cb('Verbindung geschlossen');
  function tryParse() {
    if (self.buf.length < 2) return false;
    var b2 = self.buf[1];
    var len = b2 & 0x7f;
    var off = 2;
    if (len === 126) {
      if (self.buf.length < 4) return false;
      len = self.buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (self.buf.length < 10) return false;
      var hi = self.buf.readUInt32BE(2);
      var lo = self.buf.readUInt32BE(6);
      len = hi * 4294967296 + lo;
      off = 10;
    }
    if (self.buf.length < off + len) return false;
    var opcode = self.buf[0] & 0x0f;
    var payload = self.buf.slice(off, off + len).toString('utf8');
    self.buf = self.buf.slice(off + len);
    if (opcode === 0x8) return cb('Server hat geschlossen');
    if (opcode === 0x9) { self.pong(Buffer.from(payload)); return tryParse(); }
    if (opcode === 0x1 || opcode === 0x2) return cb(null, payload);
    return tryParse();
  }
  if (tryParse() !== false) return;
  var fertig = false;
  var frist = setTimeout(function () {
    if (fertig) return;
    fertig = true;
    self.s.removeListener('data', onData);
    cb('timeout');
  }, timeoutMs || 20000);
  var onData = function () {
    if (fertig) return;
    /* tryParse ruft cb() selbst auf, wenn ein Textrahmen vollständig ist. */
    if (tryParse() !== false) {
      fertig = true;
      clearTimeout(frist);
      self.s.removeListener('data', onData);
    }
  };
  self.s.on('data', onData);
};

Ws.prototype.close = function () {
  if (this.dead) return;
  this.dead = true;
  try { this.s.setTimeout(0); } catch (e) { /* egal */ }
  try { this.s.removeAllListeners('data'); } catch (e) { /* egal */ }
  try { this.s.destroy(); } catch (e) { /* egal */ }
};

/* ---------- SSAP ---------- */

/* Register with the TV. Without a key the TV shows a prompt; with a good key it answers
 * right away. Gives back { key } or an error text. */
function register(opts, cb) {
  var host = opts.host || '127.0.0.1';
  var known = readKey();
  var fertig = false;
  function finish(err, val) {
    if (fertig) return;
    fertig = true;
    cb(err, val);
  }
  Ws.connect(host, SSAP_PORT, function (e, ws) {
    if (e) return finish(e);
    var geschlossen = false;
    function zu(err, val) {
      if (geschlossen) return;
      geschlossen = true;
      clearTimeout(hart);
      ws.close();
      finish(err, val);
    }
    var payload = { forcePairing: false, pairingType: 'PROMPT', manifest: MANIFEST };
    if (known && known.key) payload['client-key'] = known.key;
    ws.send({ type: 'register', id: 'reg', payload: payload });
    var deadline = (opts.waitSeconds || 90) * 1000;
    var start = Date.now();
    var hart = setTimeout(function () {
      zu('keine Antwort vom Fernseher (Dialog am Gerät bestätigt?)');
    }, deadline + 3000);
    function loop() {
      if (Date.now() - start > deadline) {
        return zu('keine Antwort vom Fernseher (Dialog am Gerät bestätigt?)');
      }
      var left = Math.max(3000, deadline - (Date.now() - start));
      ws.recv(function (e2, text) {
        if (e2) return zu(e2 === 'timeout' ? 'keine Antwort vom Fernseher (Dialog am Gerät bestätigt?)' : e2);
        var msg;
        try { msg = JSON.parse(text); } catch (e3) { return loop(); }
        var key = (msg.payload || {})['client-key'];
        if (key) {
          writeKey({ key: key, tv: opts.tv || '', saved: new Date().toISOString() });
          return zu(null, { key: key, fresh: !(known && known.key === key) });
        }
        if (msg.type === 'error') return zu(msg.error || 'Fehler');
        loop();
      }, left);
    }
    loop();
  });
}

/* Ask for the pointer socket and press keys through it. */
function press(keys, opts, cb) {
  var host = opts.host || '127.0.0.1';
  var names = [];
  for (var i = 0; i < keys.length; i++) {
    var n = buttonName(keys[i]);
    if (!n) return cb('unbekannte Taste: ' + keys[i]);
    names.push(n);
  }
  var known = readKey();
  if (!known || !known.key) return cb('noch nicht gekoppelt');
  (function (res) {
    Ws.connect(host, SSAP_PORT, function (e2, ws) {
      if (e2) return cb(e2);
      ws.send({ type: 'register', id: 'reg', payload: {
        forcePairing: false, pairingType: 'PROMPT', manifest: MANIFEST,
        'client-key': res.key
      } });
      /* Der Fernseher schickt erst die Bestätigung ("response") und dann den
       * eigentlichen "registered"-Rahmen — deshalb warten, bis der kommt. */
      var versuche = 0;
      function warteAufRegistered() {
        versuche += 1;
        if (versuche > 6) { ws.close(); return cb('Registrierung abgelehnt'); }
        ws.recv(function (e3, text) {
          if (e3) { ws.close(); return cb(e3); }
          var msg = null;
          try { msg = JSON.parse(text); } catch (e4) { msg = null; }
          if (msg && msg.type === 'error') { ws.close(); return cb(msg.error || 'Fehler'); }
          if (!msg || msg.type !== 'registered') return warteAufRegistered();
          ws.send({ type: 'request', id: 'ptr',
            uri: 'ssap://com.webos.service.networkinput/getPointerInputSocket' });
          ws.recv(function (e5, text2) {
            ws.close();
            if (e5) return cb(e5);
            var antwort;
            try { antwort = JSON.parse(text2); } catch (e6) { return cb('unlesbare Antwort'); }
            var sockPath = (antwort.payload || {}).socketPath;
            if (!sockPath) return cb((antwort.error || 'kein Pointer-Socket'));
            sendFrames(sockPath, names, cb);
          });
        }, 8000);
      }
      warteAufRegistered();
    });
  })(known);
}

/* The pointer socket is a unix socket on the device and a ws:// URL on the network. */
function sendFrames(sockPath, names, cb) {
  var done = [];
  function next(i) {
    if (i >= names.length) return cb(null, done);
    var frame = JSON.stringify({ type: 'button', name: names[i] }) + '\n';
    var target = sockPath;
    var sock;
    if (target.indexOf('ws://') === 0 || target.indexOf('wss://') === 0) {
      var url = target.split('://')[1];
      var hostPort = url.split('/')[0];
      var pathPart = '/' + url.split('/').slice(1).join('/');
      var hp = hostPort.split(':');
      sock = net.connect(parseInt(hp[1] || '3000', 10), hp[0]);
      sock.on('connect', function () {
        sock.write('GET ' + pathPart + ' HTTP/1.1\r\nHost: ' + hostPort +
          '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') +
          '\r\nSec-WebSocket-Version: 13\r\n\r\n');
        setTimeout(function () { sock.write(frame); }, 150);
      });
    } else {
      sock = net.connect(target);
      sock.on('connect', function () { sock.write(frame); });
    }
    sock.on('error', function (e) {
      done.push({ name: names[i], ok: false, error: e.code || String(e) });
      next(i + 1);
    });
    setTimeout(function () {
      try { sock.destroy(); } catch (e) { /* egal */ }
      done.push({ name: names[i], ok: true });
      setTimeout(function () { next(i + 1); }, 250);
    }, 700);
  }
  next(0);
}

function status() {
  var k = readKey();
  return { paired: !!(k && k.key), tv: (k && k.tv) || '', saved: (k && k.saved) || '' };
}

module.exports = { register: register, press: press, status: status, BUTTONS: BUTTONS };
