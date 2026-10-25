/*
 * CleanFrame Config-Server.
 *
 * Laeuft auf dem Fernseher (webOS, node) und liefert die Web-Oberflaeche zur
 * Konfiguration des Launchers. Aufbau bewusst wie Glasshouse (tvweb.js):
 * ein Prozess, keine Abhaengigkeiten ausser node-Bordmitteln, Routen unter
 * /api/*, statische Dateien aus assets/, Token optional.
 *
 * API (alles JSON, alles ohne Anmeldung von 127.0.0.1 aus):
 *   GET  /api/health              Version, Laufzeit, Konfigurationspfad
 *   GET  /api/config              aktuelle Konfiguration (Token redigiert)
 *   PUT  /api/config              Konfiguration speichern (vollstaendig)
 *   GET  /api/apps                App-Katalog (Glasshouse + System-Apps)
 *   GET  /api/diag                Voraussetzungen pruefen
 *   POST /api/ha/check            Home-Assistant-URL und Token pruefen
 *   GET  /api/backup              Konfiguration als Download
 *   POST /api/backup              Konfiguration importieren
 *   GET  /api/selftest            interne Pruefungen (fuer Tests ohne Fernseher)
 *   POST /api/system/restart      Dienst neu starten (nur mit root)
 *
 * Auth wie bei Glasshouse: ohne konfiguriertes Token ist alles erlaubt,
 * Anfragen von 127.0.0.1 sind immer erlaubt (dort laeuft der Launcher).
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var config = require('./lib/config');
var appCatalog = require('./lib/apps');
var diag = require('./lib/diag');

var VERSION = '0.1.0';
var PORT = parseInt(process.env.CF_PORT || '8484', 10);
var CONFIG_PATH = process.env.CF_CONFIG || '/var/lib/cleanframe/config.json';
var ASSETS = path.join(__dirname, 'assets');
var TV_BASE = process.env.CF_GLASSHOUSE || 'http://127.0.0.1:8080';
var STUB = process.env.CF_STUB_APPS || '';

var store = new config.Store(CONFIG_PATH);
var token = process.env.CF_TOKEN || '';
var startedAt = Date.now();

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function send(res, code, body, headers) {
  var h = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
  res.writeHead(code, h);
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function fromTV(req) {
  var ra = (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || '';
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}

/* Vergleich ohne Rueckschluss auf die Tokenlaenge (kein timingSafeEqual in
 * alten node-Versionen auf dem Fernseher). */
function tokenMatches(given) {
  if (!token) return false;
  if (typeof given !== 'string') return false;
  var diff = given.length ^ token.length;
  for (var i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

function authed(q, req) {
  if (!token) return true;
  if (fromTV(req)) return true;
  var bearer = /^Bearer\s+(\S+)$/i.exec((req.headers.authorization || ''));
  if (bearer && tokenMatches(bearer[1])) return true;
  return !!(q && q.k && tokenMatches(q.k));
}

/* CSRF: eine POST mit "einfachem" Content-Type wird vom Browser ohne Preflight
 * zugestellt. Deshalb nur application/json erlauben und fremde Origins
 * ablehnen — dieselbe Ueberlegung wie Glasshouses postGuard. */
function postGuard(req, res) {
  var ctype = String(req.headers['content-type'] || '').toLowerCase();
  if (ctype.indexOf('application/json') !== 0) {
    json(res, 415, { ok: false, error: 'Content-Type muss application/json sein' });
    return false;
  }
  var origin = req.headers.origin;
  if (origin) {
    var host = req.headers.host;
    var o;
    try { o = new URL(origin); } catch (e) { o = null; }
    if (!o || o.host !== host) {
      json(res, 403, { ok: false, error: 'cross-origin request refused' });
      return false;
    }
  }
  return true;
}

function readBody(req, cb) {
  var body = '';
  req.setEncoding('utf8');
  req.on('data', function (c) {
    body += c;
    if (body.length > 1024 * 1024) req.destroy();
  });
  req.on('end', function () {
    var parsed = null;
    try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = null; }
    cb(parsed, parsed === null ? 'ungueltiges JSON' : '');
  });
}

function serveStatic(u, res) {
  var rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
  if (rel.indexOf('..') >= 0) return send(res, 400, 'bad path');
  var file = path.join(ASSETS, rel);
  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, 'not found');
    var ext = path.extname(file).toLowerCase();
    send(res, 200, data, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  });
}

function stubApps() {
  if (!STUB) return null;
  try { return JSON.parse(fs.readFileSync(STUB, 'utf8')); } catch (e) { return null; }
}

function handle(req, res) {
  var u = url.parse(req.url, true);
  var q = u.query || {};
  var p = u.pathname;

  if (p.indexOf('/api/') === 0 && !authed(q, req)) {
    return json(res, 401, { ok: false, error: 'Token fehlt oder falsch' });
  }

  if (req.method === 'GET' && p === '/api/health') {
    return json(res, 200, {
      ok: true,
      name: 'cleanframe-web',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      configPath: CONFIG_PATH,
      glasshouse: TV_BASE,
      tokenRequired: !!token && !fromTV(req)
    });
  }

  if (req.method === 'GET' && p === '/api/config') {
    var cfg = store.read();
    return json(res, 200, { ok: true, config: config.redact(cfg), schemaVersion: config.VERSION });
  }

  if (req.method === 'PUT' && p === '/api/config') {
    if (!postGuard(req, res)) return;
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      /* Ein leeres Token im Request bedeutet "unveraendert lassen", damit die
       * Oberflaeche das Geheimnis nie im Klartext zurueckschicken muss. */
      var current = store.read();
      var incoming = body && body.config ? body.config : body;
      if (incoming && incoming.integrations) {
        var ha = incoming.integrations.ha || {};
        var mq = incoming.integrations.mqtt || {};
        if (!ha.token) ha.token = current.integrations.ha.token;
        if (!mq.password) mq.password = current.integrations.mqtt.password;
      }
      var saved;
      try { saved = store.write(incoming); } catch (e) {
        return json(res, 500, { ok: false, error: 'Speichern fehlgeschlagen: ' + e.message });
      }
      json(res, 200, { ok: true, config: config.redact(saved), updatedAt: saved.updatedAt });
    });
  }

  if (req.method === 'GET' && p === '/api/apps') {
    return appCatalog.catalog({ base: TV_BASE, stub: stubApps() }, function (err, out) {
      json(res, 200, out);
    });
  }

  if (req.method === 'GET' && p === '/api/diag') {
    return diag.run({ configPath: CONFIG_PATH }, function (out) {
      json(res, out.ok ? 200 : 200, out);
    });
  }

  if (req.method === 'POST' && p === '/api/ha/check') {
    if (!postGuard(req, res)) return;
    return readBody(req, function (body) {
      var current = store.read();
      var haUrl = (body && body.url) || current.integrations.ha.url;
      var haToken = (body && body.token) || current.integrations.ha.token;
      diag.haCheck(haUrl, haToken, function (r) { json(res, 200, r); });
    });
  }

  if (req.method === 'GET' && p === '/api/backup') {
    var cfg2 = store.read();
    var stamp = new Date().toISOString().slice(0, 10);
    return send(res, 200, JSON.stringify({ kind: 'cleanframe-backup', schemaVersion: config.VERSION, exportedAt: new Date().toISOString(), config: cfg2 }, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cleanframe-backup-' + stamp + '.json"'
    });
  }

  if (req.method === 'POST' && p === '/api/backup') {
    if (!postGuard(req, res)) return;
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      var payload = body && body.config ? body.config : body;
      if (body && body.kind && body.kind !== 'cleanframe-backup') {
        return json(res, 400, { ok: false, error: 'keine CleanFrame-Sicherung' });
      }
      var saved;
      try { saved = store.write(payload); } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
      json(res, 200, { ok: true, imported: true, config: config.redact(saved) });
    });
  }

  if (req.method === 'GET' && p === '/api/selftest') {
    var checks = [];
    function check(name, fn) {
      try { var r = fn(); checks.push({ name: name, ok: !!r, detail: r === true ? '' : String(r) }); }
      catch (e) { checks.push({ name: name, ok: false, detail: e.message }); }
    }
    check('Standardkonfiguration ist gueltig', function () {
      var c = config.validate(config.defaults());
      return c.schemaVersion === config.VERSION;
    });
    check('Unbekannte Sprache faellt auf system zurueck', function () {
      return config.validate({ lang: 'klingon' }).lang === 'system';
    });
    check('Startseiten-Eintrag ohne appId wird verworfen', function () {
      return config.validate({ home: [{ name: 'x' }] }).home.length === 0;
    });
    check('Doppelte appIds werden entfernt', function () {
      var c = config.validate({ home: [{ appId: 'netflix' }, { appId: 'netflix' }] });
      return c.home.length === 1;
    });
    check('Token wird beim Lesen redigiert', function () {
      var c = config.validate({ integrations: { ha: { url: 'http://x', token: 'geheim' } } });
      var r = config.redact(c);
      return r.integrations.ha.token === '' && r.integrations.ha.hasToken === true;
    });
    check('Konfiguration laesst sich schreiben und lesen', function () {
      var tmp = new config.Store(CONFIG_PATH + '.selftest');
      tmp.write({ lang: 'de', home: [{ appId: 'netflix', name: 'Filme' }] });
      var back = tmp.read();
      try { fs.unlinkSync(CONFIG_PATH + '.selftest'); } catch (e) {}
      return back.lang === 'de' && back.home.length === 1 && back.home[0].name === 'Filme';
    });
    var allOk = checks.every(function (c) { return c.ok; });
    return json(res, 200, { ok: allOk, version: VERSION, checks: checks });
  }

  if (req.method === 'POST' && p === '/api/system/restart') {
    if (!postGuard(req, res)) return;
    json(res, 202, { ok: true, restarting: true });
    setTimeout(function () { process.exit(0); }, 200);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(u, res);
  json(res, 405, { ok: false, error: 'Methode nicht erlaubt' });
}

/* Ein Fehler in einer Route darf den Dienst auf dem Fernseher nicht beenden:
 * der Server hat keinen Aufsichtspfad wie ein Supervisor, er muss weiterlaufen. */
var server = http.createServer(function (req, res) {
  try {
    handle(req, res);
  } catch (e) {
    try {
      json(res, 500, { ok: false, error: 'interner Fehler: ' + e.message });
    } catch (e2) {
      try { res.destroy(); } catch (e3) {}
    }
  }
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('cleanframe-web ' + VERSION + ' auf Port ' + PORT + ', Konfiguration: ' + CONFIG_PATH);
});

process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });

module.exports = server;
