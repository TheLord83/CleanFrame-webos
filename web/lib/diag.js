/*
 * Diagnose: prueft in einem Durchgang, ob die Voraussetzungen stimmen.
 * Dieselben Pruefungen stehen als /api/diag bereit und werden im Installer
 * angezeigt — definiert an einer Stelle, nicht zweimal geschrieben.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var http = require('http');
var urlmod = require('url');
var https = require('https');
var configLib = require('./config');

function tcpOk(host, port, timeout, cb) {
  var net = require('net');
  var sock = net.connect({ host: host, port: port });
  var done = false;
  function finish(ok, err) {
    if (done) return;
    done = true;
    try { sock.destroy(); } catch (e) {}
    cb({ ok: ok, error: err || '' });
  }
  sock.setTimeout(timeout || 1500);
  sock.on('connect', function () { finish(true); });
  sock.on('timeout', function () { finish(false, 'timeout'); });
  sock.on('error', function (e) { finish(false, e.code || String(e)); });
}

function run(opts, cb) {
  var checks = [];
  var pending = 0;

  function add(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail || '' });
  }
  function finish() {
    cb({
      ok: checks.every(function (c) { return c.ok; }),
      checks: checks,
      host: os.hostname(),
      platform: os.platform(),
      node: process.version
    });
  }

  add('Konfigurationsdatei lesbar', !!opts.configPath, opts.configPath || 'kein Pfad');
  try {
    var dir = require('path').dirname(opts.configPath);
    configLib.mkdirp(dir);
    fs.accessSync(dir, fs.constants.W_OK);
    add('Konfigurationsordner schreibbar', true, dir);
  } catch (e) {
    add('Konfigurationsordner schreibbar', false, String(e && e.message));
  }

  add('Root-Rechte', typeof process.getuid === 'function' ? process.getuid() === 0 : true,
      typeof process.getuid === 'function' ? 'uid=' + process.getuid() : 'nicht ermittelbar');

  /* Glasshouse ist die Icon- und App-Quelle; ohne sie laeuft der Launcher, aber
   * ohne echte Icons. Deshalb eine Warnung, kein Fehler. */
  pending++;
  tcpOk('127.0.0.1', 8080, 1500, function (r) {
    add('Glasshouse erreichbar (127.0.0.1:8080)', r.ok, r.ok ? '' : r.error);
    pending--;
    if (!pending) finish();
  });

  pending++;
  tcpOk('127.0.0.1', 3000, 1500, function (r) {
    add('SSAP-Port 3000 offen', r.ok, r.ok ? '' : r.error);
    pending--;
    if (!pending) finish();
  });
}

/* Prueft eine Home-Assistant-Instanz gegen /api/ und meldet die Version —
 * damit die Oberflaeche beim Eintragen sofort weiss, ob URL und Token passen. */
function haCheck(url, token, cb, tiefe) {
  /* Home Assistant laeuft oft hinter HTTPS. Zuerst wurde hier immer http.get
   * benutzt — bei einer https-URL antwortete der Proxy deshalb mit 301, und die
   * Pruefung meldete "keine Verbindung". Jetzt richtiges Protokoll und
   * Weiterleitungen folgen (bis drei Stufen). */
  if (!url) return cb({ ok: false, error: 'keine URL' });
  var u = urlmod.parse(url);
  if (!u.hostname) return cb({ ok: false, error: 'URL ungueltig' });
  var secure = u.protocol === 'https:';
  var lib = secure ? https : http;
  var path = u.pathname && u.pathname !== '/' ? u.pathname : '/api/';
  var req = lib.get({
    host: u.hostname,
    port: u.port || (secure ? 443 : 80),
    path: path,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    timeout: 6000,
    rejectUnauthorized: false
  }, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var stufe = (tiefe || 0);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && stufe < 3) {
        var ziel = res.headers.location;
        if (ziel.charAt(0) === '/') ziel = (secure ? 'https://' : 'http://') + u.host + ziel;
        return haCheck(ziel, token, cb, stufe + 1);
      }
      var j = null;
      try { j = JSON.parse(b); } catch (e) {}
      cb({ ok: res.statusCode === 200, status: res.statusCode, message: (j && j.message) || '', url: url });
    });
  });
  req.on('timeout', function () { req.abort(); cb({ ok: false, error: 'timeout' }); });
  req.on('error', function (e) { cb({ ok: false, error: e.code || String(e) }); });
}

module.exports = { run: run, haCheck: haCheck, tcpOk: tcpOk };
