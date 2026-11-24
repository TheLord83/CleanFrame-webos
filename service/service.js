// CleanFrame start service.
//
// Two jobs, both of which a normal root script cannot do on webOS 6.5: the
// luna bus only lets a *registered* service talk to the application manager,
// so launching the launcher from init.d, ssh or a plain node script is refused
// ("Not permitted to send to com.webos.applicationManager"). This file is
// therefore installed as a dev service and started through the elevated
// wrapper; that is how the open source launchers do it too.
//
//   --boot    launch the app once the application manager is ready, retrying
//             for about a minute after a cold boot
//   --watch   read the remote (no grab) and launch the app when HOME is pressed
//
// Everything is reversible: stop the process, remove the init.d link.
var Service = require('webos-service');
var fs = require('fs');

var APP_ID = process.env.CF_APP_ID || 'com.blackpearl.cleanframe';
var HOME_CODE = parseInt(process.env.CF_HOME_CODE || '773', 10); // measured on this remote
var LOG = process.env.CF_LOG || '/tmp/cfsvc.log';
var EVENT_SIZE = 16; // struct input_event, 32 bit
var TICK_MS = 16;
var DEBUG_KEYS = process.env.CF_DEBUG_KEYS === '1';
var HOME_APP = 'com.webos.app.home';
var RETRY_MS = 2000;
var RETRY_MAX = 30;

// webos-service would exit after ~5 s without this.
if (process.argv.indexOf('--disable-timeouts') === -1) process.argv.push('--disable-timeouts');

function log(line) {
	try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n'); } catch (e) {}
}

var service = new Service('com.blackpearl.cleanframe.service');
log('service up pid=' + process.pid + ' args=' + process.argv.slice(2).join(' '));

// ------------------------------------------------------------------ launching
var launching = false;
function launch(reason, done, id) {
	if (launching) { if (done) done({ skipped: true }); return; }
	launching = true;
	setTimeout(function () { launching = false; }, 800);
	service.call('luna://com.webos.applicationManager/launch', { id: id || APP_ID }, function (m) {
		var p = (m && m.payload) || {};
		log('launch (' + reason + ') -> ' + JSON.stringify(p));
		if (done) done(p);
	});
}

// The application manager is not ready in the first seconds after boot, so the
// boot launch keeps trying instead of failing once.
function launchAtBoot(attempt) {
	attempt = attempt || 1;
	launch('boot#' + attempt, function (p) {
		if (p && p.returnValue === true) { log('boot launch ok'); return; }
		if (attempt < RETRY_MAX) setTimeout(function () { launchAtBoot(attempt + 1); }, RETRY_MS);
		else log('boot launch gave up after ' + attempt);
	});
}

// ---------------------------------------------------------------- home button
// Read every input device: which eventN carries HOME differs between models
// (here it is event3, not the "Smart Remote" node the device list suggests).
// Blocking reads would use up libuv's four threads, so: O_NONBLOCK + timer.
function watchRemote() {
	var files;
	try { files = fs.readdirSync('/dev/input').filter(function (f) { return f.indexOf('event') === 0; }); }
	catch (e) { log('cannot list /dev/input: ' + e.message); return; }

	var fds = [];
	files.forEach(function (f) {
		try {
			fds.push({ name: f, fd: fs.openSync('/dev/input/' + f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK) });
		} catch (e) { /* no permission: skip, not an error */ }
	});
	log('watching ' + fds.length + ' input devices for code ' + HOME_CODE);

	var buf = new Buffer(EVENT_SIZE * 64);
	setInterval(function () {
		fds.forEach(function (d) {
			var bytes = 0;
			try { bytes = fs.readSync(d.fd, buf, 0, buf.length, null); } catch (e) { return; }
			for (var off = 0; off + EVENT_SIZE <= bytes; off += EVENT_SIZE) {
				// EV_KEY = 1, value 1 = pressed
				if (buf.readUInt16LE(off + 8) !== 1 || buf.readInt32LE(off + 12) !== 1) continue;
				var code = buf.readUInt16LE(off + 10);
				// Which device carries which key differs per television, so with
				// CF_DEBUG_KEYS=1 every key is logged - that is how the code for
				// HOME was found here in the first place.
				if (DEBUG_KEYS) log('key ' + d.name + ' code=' + code);
				if (code === HOME_CODE) {
					log('HOME pressed on ' + d.name);
					launch('home-key');
				}
			}
		});
	}, TICK_MS);
}

// ------------------------------------------------- watching the home screen
// The reliable way, and independent of the remote: subscribe to what is in
// front and come back as soon as LG's home screen appears. Reading the HOME
// key only works while the key reaches us at all - this does not care.
// A subscription to getForegroundAppInfo delivers exactly one message on this
// television and then goes quiet, so this asks once a second instead. One luna
// call per second is nothing, and it cannot silently stop working.
var FOREGROUND_MS = 1000;
var HOME_TRIES = 6;    // so often per home episode, then it is someone else's turn
var lastForeground = '';
var homeTries = 0;
function watchForeground() {
	setInterval(function () {
		service.call('luna://com.webos.applicationManager/getForegroundAppInfo', {}, function (m) {
			var p = (m && m.payload) || {};
			if (!p.appId) return;
			if (p.appId !== lastForeground) {
				lastForeground = p.appId;
				if (DEBUG_KEYS) log('foreground: ' + p.appId);
			}
			if (p.appId !== HOME_APP) { homeTries = 0; return; }
			// The first launch right after the home screen appears is accepted
			// (returnValue true) and then swallowed while LG's home is still
			// starting up - and because the foreground does not change, an
			// "only launch once" rule would never try again. So: try again,
			// a bounded number of times per appearance.
			if (homeTries >= HOME_TRIES) return;
			homeTries++;
			log('home screen in front -> coming back (try ' + homeTries + '/' + HOME_TRIES + ')');
			launch('home-screen');
		});
	}, FOREGROUND_MS);
}

// ------------------------------------------------------------------- luna API
service.register('status', function (m) {
	m.respond({ returnValue: true, pid: process.pid, uptime: process.uptime(), appId: APP_ID });
});
service.register('launch', function (m) {
	launch('api', function (p) { m.respond(p || { returnValue: false }); });
});

// ------------------------------------------------------------------------ go
// Testhaken: einmal LGs Startseite nach vorne holen, damit sich die
// Vordergrund-Ueberwachung ohne Fernbedienung pruefen laesst.
if (process.env.CF_TEST_HOME === '1') {
	setTimeout(function () { log('test: opening the home screen myself'); launch('test-home', null, HOME_APP); }, 5000);
}

if (process.argv.indexOf('--boot') !== -1) launchAtBoot(1);
if (process.argv.indexOf('--watch') !== -1) {
	watchRemote();
	watchForeground();
}
