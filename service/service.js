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
function launch(reason, done) {
	if (launching) { if (done) done({ skipped: true }); return; }
	launching = true;
	setTimeout(function () { launching = false; }, 1500);
	service.call('luna://com.webos.applicationManager/launch', { id: APP_ID }, function (m) {
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
				if (buf.readUInt16LE(off + 8) === 1 && buf.readUInt16LE(off + 10) === HOME_CODE && buf.readInt32LE(off + 12) === 1) {
					log('HOME pressed on ' + d.name);
					launch('home-key');
				}
			}
		});
	}, TICK_MS);
}

// ------------------------------------------------------------------- luna API
service.register('status', function (m) {
	m.respond({ returnValue: true, pid: process.pid, uptime: process.uptime(), appId: APP_ID });
});
service.register('launch', function (m) {
	launch('api', function (p) { m.respond(p || { returnValue: false }); });
});

// ------------------------------------------------------------------------ go
if (process.argv.indexOf('--boot') !== -1) launchAtBoot(1);
if (process.argv.indexOf('--watch') !== -1) watchRemote();
