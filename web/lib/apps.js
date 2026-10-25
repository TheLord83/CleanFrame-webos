/*
 * App-Katalog fuer die Web-Oberflaeche.
 *
 * Quelle ist Glasshouse auf dem Fernseher (127.0.0.1:8080). Glasshouse fuehrt
 * nur entfernbare Apps und die Kacheln von LGs Leiste; eingebaute System-Apps
 * fehlen dort und werden hier ergaenzt. Ohne erreichbares Glasshouse bleibt der
 * Katalog nutzbar (System-Apps), damit die Oberflaeche nicht leer ist.
 */
'use strict';

var http = require('http');

var BUILTIN = [
  { appId: 'com.webos.app.enactbrowser', name: 'Webbrowser', system: true },
  { appId: 'org.webosbrew.hbchannel', name: 'Homebrew Channel', system: true },
  { appId: 'com.blackpearl.cleanframe', name: 'CleanFrame', system: true },
  { appId: 'com.webos.app.mediadiscovery', name: 'Media Player', system: true },
  { appId: 'com.webos.app.hdmi1', name: 'HDMI 1', system: true },
  { appId: 'com.webos.app.hdmi2', name: 'HDMI 2', system: true },
  { appId: 'com.webos.app.hdmi3', name: 'HDMI 3', system: true },
  { appId: 'com.webos.app.hdmi4', name: 'HDMI 4', system: true },
  { appId: 'com.palm.app.settings', name: 'TV-Einstellungen', system: true },
  { appId: 'com.webos.app.screensaver', name: 'Bildschirmschoner', system: true },
  { appId: 'com.webos.app.home', name: 'LG Startseite', system: true }
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
    out.push({ appId: b.appId, name: b.name, system: true, icon: '' });
  });
  out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'de'); });
  return out;
}

/* Glasshouse liefert `installed` (App-Liste) und `systemTiles`. Fuer die
 * Oberflaeche zaehlt nur: welche App kann auf die Startseite, wie heisst sie,
 * wo liegt ihr Icon. */
function fromGlasshouse(payload, base) {
  var list = [];
  ((payload && payload.installed) || []).forEach(function (a) {
    if (!a || !a.id) return;
    list.push({
      appId: a.id,
      name: a.title || a.id,
      system: false,
      icon: base + '/api/apps/icon?id=' + encodeURIComponent(a.id)
    });
  });
  ((payload && payload.systemTiles) || []).forEach(function (t) {
    if (!t || !t.id) return;
    list.push({
      appId: t.id,
      name: t.title || t.id,
      system: true,
      icon: base + '/api/apps/icon?id=' + encodeURIComponent(t.id)
    });
  });
  return list;
}

/* `stub` ist ein JSON-Array im selben Format wie oben. Der Testbetrieb ohne
 * Fernseher laeuft damit, ohne dass eine Verzweigung in den Anfragepfad muss. */
function catalog(opts, cb) {
  if (opts && opts.stub) {
    return cb(null, { ok: true, source: 'stub', apps: merge(fromGlasshouse(opts.stub, '')) });
  }
  var base = (opts && opts.base) || 'http://127.0.0.1:8080';
  var req = http.get(base + '/api/apps', { timeout: 4000 }, function (res) {
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

module.exports = { BUILTIN: BUILTIN, catalog: catalog, merge: merge };
