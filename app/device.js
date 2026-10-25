/* CleanFrame auf LG webOS — Geraeteanbindung.
 *
 * Zwei Wege, bewusst getrennt:
 *
 * 1. Aktionen (App starten, LG Home, TV-Einstellungen, Bildschirmschoner) laufen ueber
 *    die native Luna-Schnittstelle der Plattform (`PalmServiceBridge`). Das ist der
 *    einzige Weg, der aus einer file://-Web-App heraus funktioniert: HTTP-Aufrufe an
 *    Glasshouse tragen einen fremden Origin-Header und werden dort mit
 *    "cross-origin request refused" abgelehnt.
 * 2. Nur fuer die App-Liste und die Icons wird Glasshouse gelesen (GET /api/apps,
 *    /api/apps/icon). GET ist nicht betroffen, und Icons sind <img>-Ladungen ohne CORS.
 *
 * Schnittstelle wie im Tizen-Original:
 *   FrameDevice.launchApp(appId, done) / launch(brand, done) / apps(done)
 *   FrameDevice.home(done) / settings(done) / art(done)
 * done bekommt (null) bei Erfolg oder ({message, detail}) bei einem Fehler.
 */
(function () {
  'use strict';

  var GW = 'http://127.0.0.1:8080';

  // Marken-Kennung in der Oberflaeche -> App-ID auf webOS.
  var IDS = {
    netflix: 'netflix',
    disneyplus: 'com.disney.disneyplus',
    youtube: 'youtube.leanback.v4',
    primevideo: 'com.amazon.amazonvideo.lite',
    spotify: 'spotify-beehive',
    appletv: 'com.apple.appletv',
    applemusic: 'com.apple.applemusic'
  };

  var BRAND_OF = {};
  Object.keys(IDS).forEach(function (brand) { BRAND_OF[IDS[brand]] = brand; });

  // Tizen-IDs, die in gespeicherten Einstellungen stecken koennen
  var TIZEN_LEGACY = {
    'org.tizen.netflix-app': 'netflix',
    'MCmYXNxgcu.DisneyPlus': 'com.disney.disneyplus',
    '9Ur5IzDKqV.TizenYouTube': 'youtube.leanback.v4',
    'org.tizen.primevideo': 'com.amazon.amazonvideo.lite',
    'rJeHak5zRg.Spotify': 'spotify-beehive',
    'com.samsung.tv.aria-video': 'com.apple.appletv'
  };

  var LG_HOME = 'com.webos.app.home';
  var LG_SETTINGS = 'com.palm.app.settings';
  var LG_SCREENSAVER = 'com.webos.app.screensaver';

  function resolve(appId) {
    if (!appId) return '';
    return TIZEN_LEGACY[appId] || IDS[appId] || appId;
  }

  /* Ein Luna-Aufruf mit Zeitlimit. cb(antwortObjekt) — nie eine Exception nach aussen. */
  function luna(uri, params, cb) {
    var settled = false, bridge, timer;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (bridge && bridge.cancel) bridge.cancel(); } catch (e) {}
      cb(result || {});
    }

    try {
      if (!window.PalmServiceBridge) {
        finish({ returnValue: false, errorText: 'no-luna-bridge' });
        return;
      }
      bridge = new window.PalmServiceBridge();
      bridge.onservicecallback = function (msg) {
        var parsed = {};
        try { parsed = JSON.parse(msg); } catch (e) { parsed = {}; }
        finish(parsed);
      };
      timer = setTimeout(function () { finish({ returnValue: false, errorText: 'timeout' }); }, 8000);
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (err) {
      finish({ returnValue: false, errorText: String(err && err.message || err) });
    }
  }

  function launchId(appId, done) {
    var id = resolve(appId);
    if (!id) { done({ message: 'Diese App hat kein Startziel.' }); return; }
    luna('luna://com.webos.applicationManager/launch', { id: id }, function (res) {
      if (res && res.returnValue === true) { done(null); return; }
      done({
        message: 'Der Fernseher konnte diese App nicht starten.',
        detail: (res && (res.errorText || res.errorCode)) ? String(res.errorText || res.errorCode) : 'unbekannt'
      });
    });
  }

  function launchApp(appId, done) { launchId(appId, done); }

  function launch(brand, done) {
    if (!IDS[brand]) {
      done({ message: 'Fuer diese App gibt es auf webOS kein Ziel.', detail: 'Bitte im Apps-Browser eine installierte App waehlen.' });
      return;
    }
    launchId(IDS[brand], done);
  }

  function home(done) { launchId(LG_HOME, done); }

  function settings(done) { launchId(LG_SETTINGS, done); }

  function art(done) { launchId(LG_SCREENSAVER, done); }

  /* App-Liste: Glasshouse (GET, ohne CORS-Problem), sonst Luna. */
  function appsFromGlasshouse(done) {
    var request;
    try {
      request = fetch(GW + '/api/apps', { cache: 'no-store' });
    } catch (err) {
      done({ message: 'Die App-Liste liess sich nicht lesen.', detail: String(err && err.message || err) });
      return;
    }
    request.then(function (res) { return res.json(); })
      .then(function (json) {
        var installed = (json && json.installed) || [];
        if (!installed.length) { appsFromLuna(done); return; }
        done(null, mergeBuiltins(installed.map(toEntry)));
      })
      .catch(function () { appsFromLuna(done); });
  }

  function appsFromLuna(done) {
    luna('luna://com.webos.applicationManager/listApps', { subscribe: false }, function (res) {
      var list = (res && res.apps) || [];
      if (!list.length) {
        done({ message: 'Die App-Liste liess sich nicht lesen.', detail: (res && res.errorText) || 'keine Antwort' });
        return;
      }
      done(null, mergeBuiltins(list
        .filter(function (a) { return a && a.id && a.visible !== false; })
        .map(function (a) { return toEntry({ id: a.id, title: a.title || a.id }); })));
    });
  }

  function toEntry(app) {
    var brand = BRAND_OF[app.id] || '';
    return {
      appId: app.id,
      name: String(app.title || app.id).slice(0, 160),
      brand: brand,
      icon: brand ? '' : (GW + '/api/apps/icon?id=' + encodeURIComponent(app.id)),
      rank: brand ? Object.keys(IDS).indexOf(brand) : 30
    };
  }

  /* System-Apps, die Glasshouse nicht in `installed` fuehrt (nur entfernbare
   * Apps und Kacheln von LG-Leiste) und die eine Startseite trotzdem braucht.
   * IDs am Gerät verifiziert (Titel aus appinfo.json). */
  var BUILTIN = [
    { id: 'com.webos.app.enactbrowser', title: 'Webbrowser' },
    { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' },
    { id: 'com.tvweb.dashboard', title: 'Glasshouse' },
    { id: 'com.webos.app.mediadiscovery', title: 'Media Player' },
    { id: 'com.webos.app.igallery', title: 'Kunstgalerie' },
    { id: 'com.palm.app.settings', title: 'TV-Einstellungen' }
  ];

  function mergeBuiltins(entries) {
    var seen = {};
    entries.forEach(function (e) { seen[e.appId] = true; });
    BUILTIN.forEach(function (b) {
      if (seen[b.id]) return;
      seen[b.id] = true;
      entries.push({
        appId: b.id,
        name: b.title,
        brand: BRAND_OF[b.id] || '',
        icon: BRAND_OF[b.id] ? '' : (GW + '/api/apps/icon?id=' + encodeURIComponent(b.id)),
        rank: 40
      });
    });
    return entries;
  }

  function apps(done) {
    var finished = false;
    function once(err, list) {
      if (finished) return;
      finished = true;
      done(err, list);
    }
    appsFromGlasshouse(once);
  }

  /* ---------- Konfiguration vom CleanFrame-Web-Server (Port 8484) ----------
   * Der Server ist die gemeinsame Quelle fuer Fernseher und Web-Oberflaeche.
   * Ist er nicht installiert, bleibt alles wie bisher (localStorage). */
  var CF_API = 'http://127.0.0.1:8484';

  function apiCall(method, path, body, done, contentType) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(err, data) {
      if (finished) return;
      finished = true;
      done(err, data);
    }
    try {
      xhr.open(method, CF_API + path, true);
      xhr.timeout = 3000;
      if (body) xhr.setRequestHeader('Content-Type', contentType || 'application/json');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var parsed = null;
        if (xhr.status === 200) {
          try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
          finish(parsed ? null : 'Antwort ist kein JSON', parsed);
        } else {
          finish('HTTP ' + xhr.status, null);
        }
      };
      xhr.ontimeout = function () { finish('timeout', null); };
      xhr.onerror = function () { finish('Server nicht erreichbar', null); };
      xhr.send(body ? JSON.stringify(body) : null);
    } catch (e) {
      finish(String(e), null);
    }
  }

  window.FrameDevice = {
    /* Konfiguration lesen; cb(null, null) wenn der Server fehlt. */
    loadConfig: function (cb) {
      apiCall('GET', '/api/config', null, function (err, data) {
        if (err || !data || !data.config) return cb(null, null);
        cb(null, data.config);
      });
    },
    /* Schreiben bewusst als POST mit text/plain: alles andere loest unter
     * Chromium 79 aus file:// einen CORS-Preflight aus, der scheitert (die
     * Anfrage kaeme nie an). Der Server nimmt text/plain nur vom Fernseher an. */
    saveConfig: function (cfg, cb) {
      apiCall('POST', '/api/config', { config: cfg }, function (err, data) {
        cb(err, data && data.config);
      }, 'text/plain;charset=UTF-8');
    },
    api: apiCall,
    launch: launch,
    launchApp: launchApp,
    art: art,
    home: home,
    settings: settings,
    apps: apps,
    resolve: resolve
  };
}());
