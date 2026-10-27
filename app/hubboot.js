/* CleanFrame Hub, bundled with the app.
 *
 * The IPK carries the hub under `hub/` so that the browser settings page works
 * right after a Homebrew Channel install, without SSH and without root being
 * asked for anything permanent. It runs only while this app runs: the process is
 * started on first start and stopped again when the app goes away.
 *
 * Starting a process from a web app is not something webOS offers. The one way in
 * is the Homebrew Channel's service (`luna://org.webosbrew.hbchannel.service/exec`),
 * which runs as root and is exactly the thing this TV already needs for the
 * launcher to exist. If it is missing, everything stays as it was: the launcher
 * runs on its localStorage configuration and the settings page simply is not there.
 *
 * A hub installed for good (override for systemd-style autostart, see
 * docs/INSTALL.md) always wins: if port 8484 already answers, nothing is started
 * here, and the stop call only ever targets the copy inside this app.
 */
(function () {
  var PORT = 8484;
  var HEALTH = 'http://127.0.0.1:' + PORT + '/api/health';
  var STATE_DIR = '/var/lib/cleanframe';
  var startedByUs = false;
  var readyCallbacks = [];
  var ready = false;

  function appDir() {
    var p = String(window.location.pathname || '');
    p = p.replace(/^file:\/\//, '');
    return p.replace(/\/[^\/]*$/, '');
  }

  function hubDir() { return appDir() + '/hub'; }

  /* Same bridge the rest of the app uses for luna calls. */
  function luna(uri, params, cb) {
    var settled = false, timer;
    function finish(res) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cb(res || { returnValue: false });
    }
    timer = setTimeout(function () { finish({ returnValue: false, errorText: 'timeout' }); }, 8000);
    try {
      if (!window.PalmServiceBridge) { finish({ returnValue: false, errorText: 'no-luna-bridge' }); return; }
      var bridge = new window.PalmServiceBridge();
      bridge.onservicecallback = function (msg) {
        var parsed = {};
        try { parsed = JSON.parse(msg); } catch (e) { parsed = {}; }
        finish(parsed);
      };
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      finish({ returnValue: false, errorText: String(e) });
    }
  }

  function probe(cb) {
    var xhr = new XMLHttpRequest(), done = false;
    function finish(ok) { if (done) return; done = true; cb(ok); }
    try {
      xhr.open('GET', HEALTH, true);
      xhr.timeout = 1500;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        finish(xhr.status === 200);
      };
      xhr.ontimeout = function () { finish(false); };
      xhr.onerror = function () { finish(false); };
      xhr.send(null);
    } catch (e) {
      finish(false);
    }
  }

  function startCommand() {
    var h = hubDir(), d = appDir();
    /* setsid where available, so the hub does not die with the shell the
     * Homebrew service runs the command in. */
    return 'H="' + h + '"; N="$(command -v node || echo /usr/bin/node)"; ' +
      'mkdir -p "' + STATE_DIR + '"; ' +
      'if command -v setsid >/dev/null 2>&1; then D=setsid; else D=; fi; ' +
      'CF_PORT=' + PORT + ' CF_CONFIG="' + STATE_DIR + '/config.json" ' +
      '$D "$N" "$H/server.js" >>"' + STATE_DIR + '/hub-bundled.log" 2>&1 & ' +
      'echo started:' + d;
  }

  function stopCommand() {
    return 'pkill -f "' + hubDir() + '/server.js" || true';
  }

  function fireReady() {
    if (ready) return;
    ready = true;
    var list = readyCallbacks;
    readyCallbacks = [];
    list.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  function boot() {
    probe(function (up) {
      if (up) { fireReady(); return; }
      luna('luna://org.webosbrew.hbchannel.service/exec', { command: startCommand() }, function (res) {
        /* The command returns as soon as the shell has forked; the hub needs a
         * moment after that. Poll instead of guessing a fixed delay. */
        var tries = 0;
        (function poll() {
          probe(function (ok) {
            if (ok) { startedByUs = true; fireReady(); return; }
            if (++tries >= 8) { fireReady(); return; }
            setTimeout(poll, 250);
          });
        })();
        if (res && res.returnValue === false) {
          /* No Homebrew service, no node, or a package without the hub: stay in
           * the localStorage mode instead of pretending otherwise. */
          if (window.console && console.log) console.log('CleanFrame: hub not started (' + (res.errorText || 'unknown') + ')');
        }
      });
    });
  }

  function stop() {
    if (!startedByUs) return;
    startedByUs = false;
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: stopCommand() }, function () {});
  }

  /* Only when the app goes away. Hiding it behind another app keeps the hub up,
   * otherwise the settings page would die with a running launcher. */
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeunload', stop);

  window.CleanFrameHubBoot = {
    dir: hubDir,
    /* Called once the hub answers or is not coming. Never blocks longer than ~3 s. */
    whenReady: function (cb) {
      if (ready) { try { cb(); } catch (e) {} return; }
      readyCallbacks.push(cb);
      setTimeout(fireReady, 3000);
    },
    /* Test hooks: no process is started or stopped by using these. */
    _startCommand: startCommand,
    _stopCommand: stopCommand,
    _probe: probe
  };

  boot();
})();
