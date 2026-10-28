/* CleanFrame on LG webOS — device binding.
 *
 * Two paths, deliberately kept apart:
 *
 * 1. Actions (start app, LG Home, TV settings, screensaver) go through the
 *    platform's native Luna interface (`PalmServiceBridge`). That is the only
 *    path that works from a file:// web app: HTTP calls to Glasshouse carry a
 *    foreign Origin header and are rejected there with
 *    "cross-origin request refused".
 * 2. Glasshouse is only read for the app list and the icons (GET /api/apps,
 *    /api/apps/icon). GET is not affected, and icons are <img> loads without CORS.
 *
 * Interface as in the Tizen original:
 *   FrameDevice.launchApp(appId, done) / launch(brand, done) / apps(done)
 *   FrameDevice.home(done) / settings(done) / art(done)
 * done receives (null) on success or ({message, detail}) on an error.
 */
(function () {
  'use strict';

  var GW = 'http://127.0.0.1:8080';

  // Brand key in the interface -> app id on webOS.
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

  // Tizen ids that may sit in saved settings
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

  /* A Luna call with a timeout. cb(responseObject) — never an exception outward. */
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

  /* App list: Glasshouse (GET, no CORS problem), otherwise Luna. */
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

  /* System apps that Glasshouse does not list in `installed` (only removable
   * apps and tiles of the LG bar) but which a home screen still needs.
   * Ids verified on the device (titles from appinfo.json). */
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

  /* ---------- Configuration from the CleanFrame web server (port 8484) ----------
   * The server is the shared source for TV and web interface.
   * If it is not installed, everything stays as before (localStorage). */
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
          var fehler = { status: xhr.status, data: null };
          try { fehler.data = JSON.parse(xhr.responseText); } catch (e) {}
          finish(fehler, null);
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
    /* The option schema carries the uploaded wallpapers; without it the
     * launcher would drop a wallpaper id it does not know. */
    loadSchema: function (cb) {
      apiCall('GET', '/api/schema', null, function (err, data) {
        if (err || !data || !data.schema) return cb(err || 'kein Schema', null);
        cb(null, data.schema);
      });
    },
    /* Read the configuration; cb(null, null) if the server is missing. */
    loadConfig: function (cb) {
      apiCall('GET', '/api/config', null, function (err, data) {
        if (err || !data || !data.config) return cb(null, null);
        cb(null, data.config);
      });
    },
    /* Writing deliberately as a POST with text/plain: anything else triggers a
     * CORS preflight under Chromium 79 from file:// that fails (the request
     * would never arrive). The server accepts text/plain only from the TV. */
    /* Saving with a revision number: if the app sits on an older revision, the
     * server answers 409 with the newer one — that is then taken over instead
     * of overwriting it. */
    saveConfig: function (cfg, cb) {
      apiCall('POST', '/api/config', { config: cfg }, function (err, data) {
        if (err && err.status === 409 && err.data && err.data.config) return cb(null, err.data.config, true);
        cb(err && (err.status || err), data && data.config);
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
