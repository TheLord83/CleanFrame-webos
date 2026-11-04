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
    /* A bench that sets FrameDevice.__apps answers from that list instead of
     * asking the device — same callback shape, so nothing else has to know. */
    if (window.FrameDevice && window.FrameDevice.__apps) {
      var stub = window.FrameDevice.__apps.slice();
      setTimeout(function () { done(null, stub); }, 0);
      return;
    }
    var finished = false;
    function once(err, list) {
      if (finished) return;
      finished = true;
      done(err, list);
    }
    appsFromGlasshouse(once);
  }

  /* ---------- HDMI inputs (External Input Manager) ----------
   * webOS has no single call that lists and switches inputs on every firmware
   * (the same reason Launch Home, MIT, keeps a fallback chain). The order here
   * is that chain, cheapest first:
   *
   *   list:  eim/getAllInputStatus -> devices[]
   *   open:  apiadapter/tv switchInput {inputId}
   *          eim/getInputStatus {id} -> applicationManager/launch with its appId
   *          utp/extinputs open {inputSourceType, options:{mediaId}}
   *
   * Everything answers with (err, value) and never throws. A device that reports
   * nothing gets an honest error, not an empty page that looks like "no inputs". */

  var HDMI = /^HDMI[_-]?(\d+)$/i;

  function hdmiNumberOf(id) {
    var m = HDMI.exec(String(id || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  function readInputs(done) {
    luna('luna://com.webos.service.eim', { method: 'getAllInputStatus', parameters: { subscribe: false } },
      function (res) {
        var devices = (res && res.devices) || [];
        if (!res || res.returnValue === false || !devices.length) {
          done({
            message: 'Der Fernseher hat keine Eingaenge gemeldet.',
            detail: (res && (res.errorText || res.errorCode)) ? String(res.errorText || res.errorCode) : 'keine Liste'
          });
          return;
        }
        var out = [], seen = {};
        devices.forEach(function (d) {
          if (!d) return;
          var id = String(d.id || d.inputId || '');
          var number = hdmiNumberOf(id);
          /* The chooser is about HDMI; other sources (tuner, apps) are not inputs. */
          if (number === null || seen[number]) return;
          seen[number] = true;
          out.push({
            number: number,
            id: id,
            name: String(d.label || d.name || ('HDMI ' + number)).slice(0, 120),
            device: String(d.connectedDeviceName || d.deviceName || '').slice(0, 120),
            connected: d.connected !== false,
            active: d.connected === true && d.active === true
          });
        });
        out.sort(function (a, b) { return a.number - b.number; });
        if (!out.length) {
          done({ message: 'Dieser Fernseher meldet keine HDMI-Eingaenge.', detail: 'devices ohne HDMI' });
          return;
        }
        done(null, out);
      });
  }

  function switchViaAdapter(input, done) {
    luna('luna://com.webos.service.apiadapter/tv', { method: 'switchInput', parameters: { inputId: input.id } },
      function (res) {
        if (res && res.returnValue === true) return done(null);
        done({ message: 'Der Eingang liess sich nicht umschalten.', detail: errText(res) }, true);
      });
  }

  function switchViaEim(input, done) {
    luna('luna://com.webos.service.eim', { method: 'getInputStatus', parameters: { id: input.id } }, function (res) {
      var appId = res && res.appId;
      if (!appId) return done({ message: 'Der Eingang hat keine App.', detail: errText(res) }, true);
      launchId(appId, function (err) {
        if (!err) return done(null);
        done({ message: err.message, detail: err.detail }, true);
      });
    });
  }

  function switchViaExtinputs(input, done) {
    var first = { inputSourceType: 'HDMI', options: { mediaId: String(input.number) } };
    luna('luna://com.webos.service.utp.extinputs', { method: 'open', parameters: first }, function (res) {
      if (res && res.returnValue === true) return done(null);
      luna('luna://com.webos.service.utp.extinputs',
        { method: 'open', parameters: { inputSourceType: 'HDMI', inputSource: input.id } }, function (res2) {
          if (res2 && res2.returnValue === true) return done(null);
          done({ message: 'Der Eingang liess sich nicht umschalten.', detail: errText(res2 || res) });
        });
    });
  }

  function errText(res) {
    if (!res) return 'keine Antwort';
    return String(res.errorText || res.errorCode || res.error || 'unbekannt');
  }

  /* Each step hands over to the next one only when it could not do the job
   * (`retry`), so the last error is the one the person sees. */
  function setSource(inputOrNumber, done) {
    var input = inputOrNumber;
    if (typeof inputOrNumber === 'number') {
      input = { id: 'HDMI_' + inputOrNumber, number: inputOrNumber };
    }
    if (!input || !input.id) { done({ message: 'Diesen Eingang gibt es nicht.' }); return; }
    switchViaAdapter(input, function (err, retry) {
      if (!retry && !err) return done(null);
      switchViaEim(input, function (err2, retry2) {
        if (!retry2 && !err2) return done(null);
        switchViaExtinputs(input, function (err3) { done(err3 || err2 || err); });
      });
    });
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
    sources: readInputs,
    setSource: setSource,
    resolve: resolve
  };
}());
