/*
 * App catalog for the web interface.
 *
 * The source is Glasshouse on the TV (127.0.0.1:8080). Glasshouse only lists
 * removable apps and the tiles of LG's bar; built-in system apps are missing
 * there and are added here. Without a reachable Glasshouse the catalog stays
 * usable (system apps), so the interface is not empty.
 */
'use strict';

var http = require('http');
var urlmod = require('url');

/* `name` is what the TV (and the stored configuration) uses — never change it.
 * `nameEn` is additive: only the web interface shows it, and only when its own
 * language is English. */
var BUILTIN = [
  { appId: 'com.webos.app.enactbrowser', name: 'Webbrowser', nameEn: 'Web browser', system: true },
  { appId: 'org.webosbrew.hbchannel', name: 'Homebrew Channel', nameEn: 'Homebrew Channel', system: true },
  { appId: 'com.blackpearl.cleanframe', name: 'CleanFrame', nameEn: 'CleanFrame', system: true },
  { appId: 'com.webos.app.mediadiscovery', name: 'Media Player', nameEn: 'Media Player', system: true },
  { appId: 'com.webos.app.hdmi1', name: 'HDMI 1', nameEn: 'HDMI 1', system: true },
  { appId: 'com.webos.app.hdmi2', name: 'HDMI 2', nameEn: 'HDMI 2', system: true },
  { appId: 'com.webos.app.hdmi3', name: 'HDMI 3', nameEn: 'HDMI 3', system: true },
  { appId: 'com.webos.app.hdmi4', name: 'HDMI 4', nameEn: 'HDMI 4', system: true },
  { appId: 'com.palm.app.settings', name: 'TV-Einstellungen', nameEn: 'TV settings', system: true },
  { appId: 'com.webos.app.screensaver', name: 'Bildschirmschoner', nameEn: 'Screensaver', system: true },
  { appId: 'com.webos.app.home', name: 'LG Startseite', nameEn: 'LG home screen', system: true }
];

function merge(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function (a) {
    if (!a || !a.appId || seen[a.appId]) return;
    seen[a.appId] = true;
    out.push(a);
  });
  BUILTIN.forEach(function (b) {
    if (seen[b.appId]) return;
    seen[b.appId] = true;
    out.push({ appId: b.appId, name: b.name, nameEn: b.nameEn, system: true, icon: '' });
  });
  out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'de'); });
  return out;
}

/* Icons are fetched through this server, never straight from Glasshouse: the
 * browser sits on another machine, where 127.0.0.1 is its own loopback. */
var ICON_ROUTE = '/api/apps/icon?id=';

/* Glasshouse returns `installed` (app list) and `systemTiles`. For the
 * interface the only things that count are: which app can go on the home
 * screen, what is it called, where is its icon. */
function fromGlasshouse(payload, base) {
  var list = [];
  ((payload && payload.installed) || []).forEach(function (a) {
    if (!a || !a.id) return;
    list.push({
      appId: a.id,
      name: a.title || a.id,
      system: false,
      icon: ICON_ROUTE + encodeURIComponent(a.id)
    });
  });
  ((payload && payload.systemTiles) || []).forEach(function (t) {
    if (!t || !t.id) return;
    list.push({
      appId: t.id,
      name: t.title || t.id,
      system: true,
      icon: ICON_ROUTE + encodeURIComponent(t.id)
    });
  });
  return list;
}

/* `stub` is a JSON array in the same format as above. Test operation without a
 * TV runs on it, so no branch is needed in the request path. */
/* The launcher reports what webOS has installed (it asks Luna directly). That
 * list is the better source: it exists without Glasshouse and it is what the
 * television itself shows. */
function fromReport(report) {
  if (!report || !Array.isArray(report.apps) || !report.apps.length) return null;
  return report.apps.map(function (a) {
    return {
      appId: a.appId,
      name: String(a.name || a.appId).slice(0, 160),
      system: !!a.system,
      icon: ICON_ROUTE + encodeURIComponent(a.appId)
    };
  });
}

function catalog(opts, cb) {
  if (opts && opts.stub) {
    return cb(null, { ok: true, source: 'stub', apps: merge(fromGlasshouse(opts.stub, '')) });
  }
  var reported = fromReport(opts && opts.report);
  if (reported) {
    var when = (opts.report && opts.report.when) || null;
    var age = when ? Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000)) : null;
    return cb(null, { ok: true, source: 'launcher', when: when, ageSeconds: age, apps: merge(reported) });
  }
  var base = (opts && opts.base) || 'http://127.0.0.1:8080';
  var target = urlmod.parse(base + '/api/apps');
  target.timeout = 4000;
  var req = http.get(target, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { body += c; if (body.length > 4 * 1024 * 1024) req.abort(); });
    res.on('end', function () {
      var payload = null;
      try { payload = JSON.parse(body); } catch (e) { payload = null; }
      if (!payload) return cb(null, { ok: false, source: 'builtin', error: 'Glasshouse antwortete nicht mit JSON', apps: merge([]) });
      cb(null, { ok: true, source: 'glasshouse', apps: merge(fromGlasshouse(payload, base)) });
    });
  });
  req.on('timeout', function () { req.abort(); });
  req.on('error', function (e) {
    cb(null, {
      ok: false,
      source: 'builtin',
      error: 'Glasshouse auf ' + base + ' nicht erreichbar (' + e.code + ')',
      apps: merge([])
    });
  });
}

module.exports = { BUILTIN: BUILTIN, catalog: catalog, merge: merge, ICON_ROUTE: ICON_ROUTE };
