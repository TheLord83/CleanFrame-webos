/* CleanFrame auf LG webOS — Geraeteanbindung.
 *
 * Ersetzt das Tizen-Gegenstueck (device.js) und bietet dieselbe Schnittstelle:
 *   FrameDevice.launchApp(appId, done)
 *   FrameDevice.launch(brand, done)
 *   FrameDevice.apps(done)           -> done(null, [{appId,name,brand,icon,rank}])
 *   FrameDevice.home(done) / settings(done) / art(done)
 *
 * Alles laeuft ueber den Glasshouse-Server auf dem Fernseher selbst (Port 8080):
 *   GET  /api/apps                 liefert die installierten Apps
 *   GET  /api/apps/icon?id=<id>    liefert das App-Icon
 *   POST /api/control              {"action":"launchApp","value":"<id>"}
 *
 * Ist Glasshouse nicht erreichbar (Browser-Vorschau), meldet jede Aktion einen
 * verstaendlichen Fehler, statt still zu scheitern.
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
  var LG_SETTINGS = 'com.webos.app.settings';
  var LG_SCREENSAVER = 'com.webos.app.screensaver';

  function bounded(done) {
    var finished = false;
    var timer = setTimeout(function () {
      finish({ message: 'Der Fernseher hat nicht geantwortet.', detail: 'Glasshouse auf Port 8080 antwortet nicht.' });
    }, 8000);

    function finish(err, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(err, value);
    }
    return finish;
  }

  function resolve(appId) {
    if (!appId) return '';
    return TIZEN_LEGACY[appId] || IDS[appId] || appId;
  }

  function control(payload, done) {
    var finish = bounded(done);
    var request;
    try {
      request = fetch(GW + '/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      finish({ message: 'Glasshouse ist nicht erreichbar.', detail: String(err && err.message || err) });
      return;
    }
    request.then(function (res) { return res.json(); })
      .then(function (json) {
        if (json && json.ok) finish(null);
        else finish({ message: 'Der Fernseher konnte diese Aktion nicht ausfuehren.', detail: (json && json.error) || '' });
      })
      .catch(function (err) {
        finish({ message: 'Glasshouse ist nicht erreichbar.', detail: String(err && err.message || err) });
      });
  }

  function launchApp(appId, done) {
    control({ action: 'launchApp', value: resolve(appId) }, done);
  }

  function launch(brand, done) {
    if (!IDS[brand]) {
      done({ message: 'Fuer diese App gibt es auf webOS kein Ziel.', detail: 'Bitte im Apps-Browser eine installierte App waehlen.' });
      return;
    }
    launchApp(IDS[brand], done);
  }

  function home(done) { launchApp(LG_HOME, done); }

  function settings(done) { launchApp(LG_SETTINGS, done); }

  function art(done) { launchApp(LG_SCREENSAVER, done); }

  function apps(done) {
    var finish = bounded(done);
    var request;
    try {
      request = fetch(GW + '/api/apps', { cache: 'no-store' });
    } catch (err) {
      finish({ message: 'Glasshouse ist nicht erreichbar.', detail: String(err && err.message || err) });
      return;
    }
    request.then(function (res) { return res.json(); })
      .then(function (json) {
        var installed = (json && json.installed) || [];
        var out = [];
        installed.forEach(function (app) {
          if (!app || !app.id) return;
          var brand = BRAND_OF[app.id] || '';
          out.push({
            appId: app.id,
            name: String(app.title || app.id).slice(0, 160),
            brand: brand,
            icon: brand ? '' : (GW + '/api/apps/icon?id=' + encodeURIComponent(app.id)),
            rank: brand ? Object.keys(IDS).indexOf(brand) : 30
          });
        });
        out.sort(function (a, b) { return a.rank - b.rank || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
        finish(null, out);
      })
      .catch(function (err) {
        finish({ message: 'Die App-Liste liess sich nicht lesen.', detail: String(err && err.message || err) });
      });
  }

  window.FrameDevice = {
    launch: launch,
    launchApp: launchApp,
    art: art,
    home: home,
    settings: settings,
    apps: apps,
    resolve: resolve
  };
}());
