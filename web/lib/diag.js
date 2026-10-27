/*
 * Diagnostics: checks in a single pass whether the prerequisites are met.
 * The same checks are served as /api/diag and shown in the installer —
 * defined in one place, not written twice.
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

  /* `label`/`labelEn` describe the check for the interface; `name` stays the
   * German name the API has always returned (installer and tests read it). */
  function add(name, nameEn, ok, detail) {
    checks.push({ name: name, label: name, labelEn: nameEn, ok: !!ok, detail: detail || '' });
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

  add('Konfigurationsdatei lesbar', 'Configuration file readable',
      !!opts.configPath, opts.configPath || 'kein Pfad');
  try {
    var dir = require('path').dirname(opts.configPath);
    configLib.mkdirp(dir);
    fs.accessSync(dir, fs.constants.W_OK);
    add('Konfigurationsordner schreibbar', 'Configuration folder writable', true, dir);
  } catch (e) {
    add('Konfigurationsordner schreibbar', 'Configuration folder writable', false, String(e && e.message));
  }

  add('Root-Rechte', 'Root privileges',
      typeof process.getuid === 'function' ? process.getuid() === 0 : true,
      typeof process.getuid === 'function' ? 'uid=' + process.getuid() : 'nicht ermittelbar');

  /* Glasshouse is the icon and app source; without it the launcher runs, but
   * without real icons. Hence a warning, not an error. */
  pending++;
  tcpOk('127.0.0.1', 8080, 1500, function (r) {
    add('Glasshouse erreichbar (127.0.0.1:8080)', 'Glasshouse reachable (127.0.0.1:8080)',
        r.ok, r.ok ? '' : r.error);
    pending--;
    if (!pending) finish();
  });

  pending++;
  tcpOk('127.0.0.1', 3000, 1500, function (r) {
    add('SSAP-Port 3000 offen', 'SSAP port 3000 open', r.ok, r.ok ? '' : r.error);
    pending--;
    if (!pending) finish();
  });
}

/* Checks a Home Assistant instance against /api/ and reports the version —
 * so the interface knows right away on entry whether URL and token fit. */
/* Self-signed certificates are a deliberate exception for this process, not the
 * default: the token that goes out here is a long-lived one. */
var INSECURE_TLS = !!process.env.CF_HA_TLS_INSECURE;
var CA_PEM = null;
try { if (process.env.CF_HA_CA) CA_PEM = require('fs').readFileSync(process.env.CF_HA_CA); } catch (e) { CA_PEM = null; }

function haCheck(url, token, cb, tiefe) {
  /* Home Assistant often runs behind HTTPS. This used to always call http.get
   * — with an https URL the proxy therefore answered 301 and the check
   * reported "no connection". Now the correct protocol is used and redirects
   * are followed (up to three hops). */
  if (!url) return cb({ ok: false, error: 'keine URL' });
  var u = urlmod.parse(url);
  if (!u.hostname) return cb({ ok: false, error: 'URL ungueltig' });
  var secure = u.protocol === 'https:';
  var lib = secure ? https : http;
  var path = u.pathname && u.pathname !== '/' ? u.pathname : '/api/';
  var opts = {
    host: u.hostname,
    port: u.port || (secure ? 443 : 80),
    path: path,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    timeout: 6000,
    /* Certificates are checked. A Home Assistant with a self-signed certificate
     * needs CF_HA_TLS_INSECURE=1, which is a decision the operator makes for the
     * whole process - not the default for a token that never expires. */
    rejectUnauthorized: !INSECURE_TLS
  };
  if (CA_PEM && secure) opts.ca = CA_PEM;
  var req = lib.get(opts, function (res) {
    var b = '';
    res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var stufe = (tiefe || 0);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && stufe < 3) {
        var ziel = res.headers.location;
        if (ziel.charAt(0) === '/') ziel = (secure ? 'https://' : 'http://') + u.host + ziel;
        /* A redirect to another host would take the Authorization header with it.
         * Follow only within the same origin. */
        var z = urlmod.parse(ziel);
        if (!z.hostname || z.hostname !== u.hostname) {
          return cb({ ok: false, status: res.statusCode, error: 'umleitung auf einen anderen Host abgelehnt' });
        }
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
