/*
 * CleanFrame config server.
 *
 * Runs on the TV (webOS, node) and serves the web interface for configuring the
 * launcher. Structure deliberately like Glasshouse (tvweb.js): one process, no
 * dependencies beyond node's standard library, routes under /api/*, static
 * files from assets/, token optional.
 *
 * API (all JSON, all without login from 127.0.0.1):
 *   GET  /api/health              version, uptime, config path
 *   GET  /api/config              current configuration (token redacted)
 *   PUT  /api/config              save configuration (complete)
 *   GET  /api/apps                app catalog (Glasshouse + system apps)
 *   GET  /api/diag                check the prerequisites
 *   POST /api/ha/check            check Home Assistant URL and token
 *   GET  /api/backup              configuration as download
 *   POST /api/backup              import configuration
 *   GET  /api/selftest            internal checks (for tests without a TV)
 *   POST /api/system/restart      restart the service (root only)
 *   GET  /api/schema              all selectable options (wallpapers, fonts, ...)
 *   GET  /api/wall/<id>           preview image of a wallpaper
 *   GET  /api/tv/snapshot         screenshot of the launcher (PNG, base64)
 *   GET  /api/tv/keys             allowed key names
 *   POST /api/tv/key              send key presses {keys: ["down","ok"]}
 *
 * Auth as with Glasshouse: without a configured token everything is allowed,
 * requests from 127.0.0.1 are always allowed (the launcher runs there).
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var config = require('./lib/config');
var appCatalog = require('./lib/apps');
var diag = require('./lib/diag');
var ha = require('./lib/ha');
var remote = require('./lib/remote');
var schema = require('./lib/schema');

var VERSION = '0.4.18';
var PORT = parseInt(process.env.CF_PORT || '8484', 10);
var CONFIG_PATH = process.env.CF_CONFIG || '/var/lib/cleanframe/config.json';
var ASSETS = path.join(__dirname, 'assets');
var TV_BASE = process.env.CF_GLASSHOUSE || 'http://127.0.0.1:8080';
/* The icons live with the launcher (one source for TV and web interface).
 * The path points at the installed app directory; if it is missing (test
 * operation), the bundled catalog is used. */
var ICON_JSON = process.env.CF_ICONS_JSON ||
  '/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe/assets/icons.json';
var ICON_DIR = process.env.CF_ICONS_DIR ||
  '/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe/assets/icons';
var WALL_DIR = process.env.CF_WALL_DIR ||
  '/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe/assets/wallpapers';
var CLIENT_LOG = process.env.CF_CLIENT_LOG || '/var/lib/cleanframe/client.log';
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

/* Depending on the platform the file app reports `Origin: null` (Chromium on a
 * desktop machine) or `Origin: file://<app-id>` (webOS on the TV). Both are the
 * same origin: a local file, not some foreign server. */
function isFileOrigin(origin) {
  return origin === 'null' || /^file:\/\//i.test(String(origin || ''));
}

function fromTV(req) {
  var ra = (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || '';
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
}

/* Comparison that does not leak the token length (no timingSafeEqual in old
 * node versions on the TV). */
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

/* CSRF: a POST with a "simple" content type is delivered by the browser without
 * a preflight. Hence only application/json is allowed and foreign origins are
 * rejected — the same reasoning as Glasshouse's postGuard. */
function postGuard(req, res) {
  var origin = req.headers.origin;
  var ctype = String(req.headers['content-type'] || '').toLowerCase();
  /* Log write attempts (without secrets): helps when a write fails on the TV
   * and you need to see where it came from. */
  console.log('[write] ' + req.method + ' ' + req.url + ' origin=' + String(origin) +
              ' ctype=' + ctype.split(';')[0] + ' from=' + ((req.connection && req.connection.remoteAddress) || '?'));
  /* Order: origin first, then content type. That way a foreign page always gets
   * 403 (even with a wrong content type) and the case stays clear.
   *
   * `Origin: null` is the file app on the TV itself; root rules there anyway.
   * Every other origin is checked even when the request comes from 127.0.0.1 —
   * otherwise a page in a LAN browser could bypass the protection by sending
   * via a local detour. */
  if (isFileOrigin(origin)) {
    if (!fromTV(req)) {
      console.log('[write-result] 403 file origin without TV');
      json(res, 403, { ok: false, error: 'cross-origin request refused' });
      return false;
    }
  } else if (origin) {
    var o = url.parse(origin);
    if (!o || !o.host || o.host !== req.headers.host) {
      console.log('[write-result] 403 origin ' + o.host + ' != host ' + req.headers.host);
      json(res, 403, { ok: false, error: 'cross-origin request refused' });
      return false;
    }
  }
  /* JSON is the normal case. `text/plain` only for the TV app: a POST with
   * application/json triggers a CORS preflight under Chromium 79 that
   * `Origin: null` does not pass there — the request would never arrive. */
  var isJson = ctype.indexOf('application/json') === 0;
  var appPlain = ctype.indexOf('text/plain') === 0 && fromTV(req) && isFileOrigin(origin);
  if (!isJson && !appPlain) {
    json(res, 415, { ok: false, error: 'Content-Type muss application/json sein' });
    return false;
  }
  return true;
}

/* The launcher runs from file:// under Chromium 79. A PUT or a POST with
 * application/json triggers a CORS preflight there that this Chromium version
 * does not pass for `Origin: null` — the request then never arrives
 * (xhr.status 0). That is why the TV app may send a POST with `text/plain`
 * (simple request, no preflight). The server accepts that only from 127.0.0.1
 * with `Origin: null`; everything else must be application/json.
 *
 * Return value as before: cb(body, errText) — errText is '' on success. */
function readBody(req, cb) {
  var type = String(req.headers['content-type'] || '').toLowerCase();
  var isJson = type.indexOf('application/json') === 0;
  var fromApp = type.indexOf('text/plain') === 0 && fromTV(req) && isFileOrigin(req.headers.origin);
  var raw = '', tooBig = false;
  if (!isJson && !fromApp) { cb(null, 'Content-Type muss application/json sein'); return; }
  req.setEncoding('utf8');
  req.on('data', function (c) {
    raw += c;
    if (raw.length > 1024 * 1024) { tooBig = true; req.destroy(); }
  });
  req.on('end', function () {
    if (tooBig) return cb(null, 'Anfrage zu gross');
    var parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch (e) { return cb(null, 'ungueltiges JSON'); }
    cb(parsed, '');
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

  /* The launcher app runs from file:// and therefore with `Origin: null`; every
   * request from 127.0.0.1 comes from the TV itself (root rules there anyway).
   * Allow CORS for this case, not for any other. */
  if (fromTV(req) && isFileOrigin(req.headers.origin)) {
    /* The origin has to be echoed back, otherwise the browser may not read the
     * response ("file://<app-id>" is not "null"). */
    res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin));
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
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

  if ((req.method === 'PUT' || req.method === 'POST') && p === '/api/config') {
    if (!postGuard(req, res)) return;
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      /* An empty token in the request means "leave unchanged", so the interface
       * never has to send the secret back in plain text. */
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
        console.log('[write-result] 500 ' + e.message);
        if (e.code === 'CONFLICT') {
          /* Older revision: do not overwrite, return the newest revision. */
          console.log('[write-result] 409 stale (got rev ' + (incoming && incoming.rev) + ', current ' + (store.read().rev) + ')');
          return json(res, 409, { ok: false, error: 'Konfiguration wurde zwischenzeitlich geaendert', config: config.redact(store.read()) });
        }
        return json(res, 500, { ok: false, error: 'Speichern fehlgeschlagen: ' + e.message });
      }
      console.log('[write-result] 200 rev=' + saved.rev + ' tiles=' + (saved.home || []).length);
      json(res, 200, { ok: true, config: config.redact(saved), updatedAt: saved.updatedAt });
    });
  }

  if (req.method === 'GET' && p === '/api/apps') {
    return appCatalog.catalog({ base: TV_BASE, stub: stubApps() }, function (err, out) {
      json(res, 200, out);
    });
  }

  if (req.method === 'POST' && p === '/api/log') {
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      var zeile = JSON.stringify({
        zeit: new Date().toISOString(),
        ua: String((req.headers['user-agent'] || '')).slice(0, 120),
        herkunft: String(req.headers.origin || ''),
        meldung: body && body.meldung ? String(body.meldung).slice(0, 300) : ''
      }) + '\n';
      try { fs.appendFileSync(CLIENT_LOG, zeile); } catch (e) {}
      json(res, 200, { ok: true });
    });
  }

  if (req.method === 'GET' && p === '/api/schema') {
    return json(res, 200, { ok: true, schema: schema.full() });
  }
  if (req.method === 'GET' && p.indexOf('/api/wall/') === 0) {
    var wallId = decodeURIComponent(p.slice('/api/wall/'.length));
    var file = schema.wallFile(wallId);
    if (!file) return json(res, 404, { ok: false, error: 'unbekanntes Wandbild' });
    var wallPath = path.join(WALL_DIR, file);
    /* Only files from the catalog, no path built from the request. */
    if (wallPath.indexOf(WALL_DIR) !== 0) return json(res, 400, { ok: false, error: 'ungueltiger Pfad' });
    return fs.readFile(wallPath, function (err, buf) {
      if (err) return json(res, 404, { ok: false, error: 'Wandbild nicht gefunden' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=86400' });
      res.end(buf);
    });
  }

  if (req.method === 'GET' && p === '/api/icons') {
    var file = fs.existsSync(ICON_JSON) ? ICON_JSON : path.join(__dirname, 'assets', 'icons.json');
    return fs.readFile(file, 'utf8', function (err, raw) {
      if (err) return json(res, 200, { ok: false, error: 'Icon-Katalog fehlt', groups: [] });
      var cat = null;
      try { cat = JSON.parse(raw); } catch (e) { cat = null; }
      if (!cat) return json(res, 200, { ok: false, error: 'Icon-Katalog ist kein JSON', groups: [] });
      json(res, 200, { ok: true, source: file, groups: cat.groups || [] });
    });
  }

  if (req.method === 'GET' && p.indexOf('/icons/') === 0) {
    var name = p.slice('/icons/'.length);
    if (!/^[A-Za-z0-9._-]+\.svg$/.test(name)) return send(res, 400, 'bad name');
    var dir = fs.existsSync(ICON_DIR) ? ICON_DIR : path.join(__dirname, 'assets', 'icons');
    return fs.readFile(path.join(dir, name), 'utf8', function (err, data) {
      if (err) return send(res, 404, 'not found');
      send(res, 200, data, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
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

  if (req.method === 'GET' && p === '/api/ha/entities') {
    var conf = store.read();
    return ha.entities(conf.integrations.ha, function (r) { json(res, 200, r); });
  }

  if (req.method === 'GET' && p === '/api/ha/values') {
    var conf2 = store.read();
    var ids = String(q.entities || '').split(',').filter(Boolean);
    if (!ids.length) ids = (conf2.integrations.ha.entities || []).map(function (e) { return e.id; });
    return ha.values(conf2.integrations.ha, ids, function (r) { json(res, 200, r); });
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
      /* A backup is deliberately always imported (no revision comparison). */
      delete payload.rev;
      try { saved = store.write(payload); } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
      json(res, 200, { ok: true, imported: true, config: config.redact(saved) });
    });
  }

  if (req.method === 'GET' && p === '/api/selftest') {
    var checks = [];
    /* `name` stays German (API contract); label/labelEn are what the interface
     * shows, so the English UI stays free of German. */
    function check(name, nameEn, fn) {
      try { var r = fn(); checks.push({ name: name, label: name, labelEn: nameEn, ok: !!r, detail: r === true ? '' : String(r) }); }
      catch (e) { checks.push({ name: name, label: name, labelEn: nameEn, ok: false, detail: e.message }); }
    }
    check('Standardkonfiguration ist gueltig', 'Default configuration is valid', function () {
      var c = config.validate(config.defaults());
      return c.schemaVersion === config.VERSION;
    });
    check('Unbekannte Sprache faellt auf system zurueck', 'Unknown language falls back to system', function () {
      return config.validate({ lang: 'klingon' }).lang === 'system';
    });
    check('Startseiten-Eintrag ohne appId wird verworfen', 'Home entry without appId is dropped', function () {
      return config.validate({ home: [{ name: 'x' }] }).home.length === 0;
    });
    check('Doppelte appIds werden entfernt', 'Duplicate appIds are removed', function () {
      var c = config.validate({ home: [{ appId: 'netflix' }, { appId: 'netflix' }] });
      return c.home.length === 1;
    });
    check('Token wird beim Lesen redigiert', 'Token is redacted on read', function () {
      var c = config.validate({ integrations: { ha: { url: 'http://x', token: 'geheim' } } });
      var r = config.redact(c);
      return r.integrations.ha.token === '' && r.integrations.ha.hasToken === true;
    });
    check('Konfiguration laesst sich schreiben und lesen', 'Configuration can be written and read', function () {
      var tmp = new config.Store(CONFIG_PATH + '.selftest');
      tmp.write({ lang: 'de', home: [{ appId: 'netflix', name: 'Filme' }] });
      var back = tmp.read();
      try { fs.unlinkSync(CONFIG_PATH + '.selftest'); } catch (e) {}
      return back.lang === 'de' && back.home.length === 1 && back.home[0].name === 'Filme';
    });
    var allOk = checks.every(function (c) { return c.ok; });
    return json(res, 200, { ok: allOk, version: VERSION, checks: checks });
  }

  /* Remote control: screenshot and key presses. Only from the TV itself and
   * from the LAN with a token — the access opens an SSH tunnel to the DevTools
   * port (9998), which is otherwise blocked. */
  if (req.method === 'GET' && p === '/api/tv/snapshot') {
    var qSnap = url.parse(req.url, true).query || {};
    return remote.snapshot({ format: qSnap.format || 'jpeg', quality: qSnap.quality || 65 }, function (err, b64, mime) {
      if (err) return json(res, 503, { ok: false, error: String(err) });
      var img = Buffer.from(b64, 'base64');
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': img.length, 'Cache-Control': 'no-store' });
      res.end(img);
    });
  }
  if (req.method === 'GET' && p === '/api/tv/keys') {
    return json(res, 200, { ok: true, keys: Object.keys(remote.KEYS) });
  }
  if (req.method === 'POST' && p === '/api/tv/key') {
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      var keys = (body && body.keys) || (body && body.key ? [body.key] : []);
      if (!Array.isArray(keys) || keys.length > 12) return json(res, 400, { ok: false, error: 'keys muss eine Liste mit hoechstens 12 Tasten sein' });
      /* Reject unknown key names right away — otherwise the server needlessly
       * opens a connection to the device and answers 503 instead of 400. */
      var known = keys.filter(function (k) { return remote.KEYS[k] !== undefined || /^[0-9]+$/.test(String(k)); });
      if (!known.length) return json(res, 400, { ok: false, error: 'unbekannte Tasten: ' + keys.join(', ') });
      remote.sendKeys(keys, { holdMs: (body && body.holdMs) || 0 }, function (e2, sent) {
        if (e2) return json(res, 503, { ok: false, error: String(e2) });
        json(res, 200, { ok: true, sent: sent });
      });
    });
  }

  /* Set the view on the TV ("Show on TV" per tab). Only a fixed list — no free
   * evaluation of expressions over the API. */
  if (req.method === 'GET' && p === '/api/tv/views') {
    return json(res, 200, { ok: true, views: Object.keys(remote.VIEWS) });
  }
  if (req.method === 'POST' && p === '/api/tv/view') {
    return readBody(req, function (body, err) {
      if (err) return json(res, 400, { ok: false, error: err });
      var name = String((body && body.view) || '').toLowerCase();
      if (!remote.VIEWS[name]) {
        return json(res, 400, { ok: false, error: 'unbekannte Ansicht: ' + name, views: Object.keys(remote.VIEWS) });
      }
      remote.evaluate(remote.VIEWS[name], function (e2, wert) {
        if (e2) return json(res, 503, { ok: false, error: String(e2) });
        json(res, 200, { ok: true, view: name, result: wert });
      });
    });
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

/* An error in a route must not take down the service on the TV: the server has
 * no supervision path like a supervisor, it has to keep running. */
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
  console.log('cleanframe-web ' + VERSION + ' on port ' + PORT + ', configuration: ' + CONFIG_PATH);
});

process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
process.on('SIGINT', function () { server.close(function () { process.exit(0); }); });

module.exports = server;
