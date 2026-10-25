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
 *   GET  /api/schema              alle Auswahlmoeglichkeiten (Wandbilder, Schriften, ...)
 *   GET  /api/wall/<id>           Vorschaubild eines Wandbildes
 *   GET  /api/tv/snapshot         Bildschirmfoto des Launchers (PNG, base64)
 *   GET  /api/tv/keys             erlaubte Tastennamen
 *   POST /api/tv/key              Tastendruecke senden {keys: ["down","ok"]}
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
var ha = require('./lib/ha');
var remote = require('./lib/remote');
var schema = require('./lib/schema');

var VERSION = '0.4.16';
var PORT = parseInt(process.env.CF_PORT || '8484', 10);
var CONFIG_PATH = process.env.CF_CONFIG || '/var/lib/cleanframe/config.json';
var ASSETS = path.join(__dirname, 'assets');
var TV_BASE = process.env.CF_GLASSHOUSE || 'http://127.0.0.1:8080';
/* Icons liegen beim Launcher (eine Quelle fuer Fernseher und Web-Oberflaeche).
 * Der Pfad zeigt auf das installierte App-Verzeichnis; fehlt es (Testbetrieb),
 * wird der mitgelieferte Katalog benutzt. */
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

/* Die Datei-App meldet je nach Plattform `Origin: null` (Chromium am Rechner)
 * oder `Origin: file://<app-id>` (webOS am Fernseher). Beides ist dieselbe
 * Herkunft: eine lokale Datei, kein fremder Server. */
function isFileOrigin(origin) {
  return origin === 'null' || /^file:\/\//i.test(String(origin || ''));
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
  var origin = req.headers.origin;
  var ctype = String(req.headers['content-type'] || '').toLowerCase();
  /* Schreibversuche protokollieren (ohne Geheimnisse): hilft, wenn am Fernseher
   * ein Schreibvorgang scheitert und man die Herkunft sehen muss. */
  console.log('[write] ' + req.method + ' ' + req.url + ' origin=' + String(origin) +
              ' ctype=' + ctype.split(';')[0] + ' von=' + ((req.connection && req.connection.remoteAddress) || '?'));
  /* Reihenfolge: erst die Herkunft, dann der Inhaltstyp. So bekommt eine fremde
   * Seite immer 403 (auch mit falschem Content-Type) und der Fall bleibt klar.
   *
   * `Origin: null` ist die Datei-App auf dem Fernseher selbst; dort herrscht
   * ohnehin root. Jede andere Origin wird auch dann geprueft, wenn die Anfrage
   * von 127.0.0.1 kommt — sonst koennte eine Seite im LAN-Browser den Schutz
   * umgehen, indem sie ueber einen lokalen Umweg sendet. */
  if (isFileOrigin(origin)) {
    if (!fromTV(req)) {
      console.log('[write-result] 403 Datei-Origin ohne TV');
      json(res, 403, { ok: false, error: 'cross-origin request refused' });
      return false;
    }
  } else if (origin) {
    var o = url.parse(origin);
    if (!o || !o.host || o.host !== req.headers.host) {
      console.log('[write-result] 403 Herkunft ' + o.host + ' != Host ' + req.headers.host);
      json(res, 403, { ok: false, error: 'cross-origin request refused' });
      return false;
    }
  }
  /* JSON ist der Normalfall. `text/plain` nur fuer die Fernseher-App: ein POST
   * mit application/json loest unter Chromium 79 einen CORS-Preflight aus, den
   * `Origin: null` dort nicht besteht — die Anfrage kaeme nie an. */
  var isJson = ctype.indexOf('application/json') === 0;
  var appPlain = ctype.indexOf('text/plain') === 0 && fromTV(req) && isFileOrigin(origin);
  if (!isJson && !appPlain) {
    json(res, 415, { ok: false, error: 'Content-Type muss application/json sein' });
    return false;
  }
  return true;
}

/* Der Launcher laeuft aus file:// unter Chromium 79. Ein PUT oder ein
 * application/json-POST loest dort einen CORS-Preflight aus, den die alte
 * Chromium-Version fuer `Origin: null` nicht zuverlaessig besteht — die Anfrage
 * kommt dann nie beim Server an (xhr.status 0). Deshalb darf die Fernseher-App
 * einen POST mit `text/plain` schicken (einfache Anfrage, kein Preflight); der
 * Server nimmt das nur von 127.0.0.1 mit `Origin: null` an. Alles andere muss
 * weiterhin application/json sein. */
/* Der Launcher laeuft aus file:// unter Chromium 79. Ein PUT oder ein POST mit
 * application/json loest dort einen CORS-Preflight aus, den diese Chromium-Version
 * fuer `Origin: null` nicht besteht — die Anfrage kommt dann nie an (xhr.status 0).
 * Deshalb darf die Fernseher-App einen POST mit `text/plain` schicken (einfache
 * Anfrage, kein Preflight). Der Server nimmt das nur von 127.0.0.1 mit
 * `Origin: null` an; alles andere muss application/json sein.
 *
 * Rueckgabe wie bisher: cb(body, fehlertext) — fehlertext ist '' bei Erfolg. */
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

  /* Die Launcher-App laeuft aus file:// und damit mit `Origin: null`; jede
   * Anfrage von 127.0.0.1 kommt vom Fernseher selbst (dort herrscht ohnehin
   * root). Fuer diesen Fall CORS erlauben, fuer alle anderen nicht. */
  if (fromTV(req) && isFileOrigin(req.headers.origin)) {
    /* Die Herkunft muss zurueckgespiegelt werden, sonst darf der Browser die
     * Antwort nicht lesen ("file://<app-id>" ist nicht "null"). */
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
        console.log('[write-result] 500 ' + e.message);
        if (e.code === 'CONFLICT') {
          /* Aelterer Stand: nicht ueberschreiben, neuesten Stand zurueckgeben. */
          console.log('[write-result] 409 veraltet (kam rev ' + (incoming && incoming.rev) + ', aktuell ' + (store.read().rev) + ')');
          return json(res, 409, { ok: false, error: 'Konfiguration wurde zwischenzeitlich geaendert', config: config.redact(store.read()) });
        }
        return json(res, 500, { ok: false, error: 'Speichern fehlgeschlagen: ' + e.message });
      }
      console.log('[write-result] 200 rev=' + saved.rev + ' kacheln=' + (saved.home || []).length);
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
    /* Nur Dateien aus dem Katalog, kein Pfad-Bau aus der Anfrage. */
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
      /* Eine Sicherung wird bewusst immer eingespielt (kein Revisionsvergleich). */
      delete payload.rev;
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

  /* Fernsteuerung: Bildschirmfoto und Tastendruecke. Nur vom Fernseher selbst
   * und aus dem LAN mit Token — der Zugriff oeffnet einen SSH-Tunnel zum
   * DevTools-Port (9998), der sonst gesperrt ist. */
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
      /* Unbekannte Tastennamen sofort abweisen — sonst oeffnet der Server
       * unnoetig eine Verbindung zum Geraet und meldet 503 statt 400. */
      var known = keys.filter(function (k) { return remote.KEYS[k] !== undefined || /^[0-9]+$/.test(String(k)); });
      if (!known.length) return json(res, 400, { ok: false, error: 'unbekannte Tasten: ' + keys.join(', ') });
      remote.sendKeys(keys, { holdMs: (body && body.holdMs) || 0 }, function (e2, sent) {
        if (e2) return json(res, 503, { ok: false, error: String(e2) });
        json(res, 200, { ok: true, sent: sent });
      });
    });
  }

  /* Ansicht am Fernseher setzen ("Am Fernseher zeigen" je Reiter). Nur eine
   * feste Liste - kein freies Auswerten von Ausdruecken ueber die API. */
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
