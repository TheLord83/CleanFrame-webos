/*
 * Heartbeat — the hub writes a timestamp next to the configuration, so "the
 * settings page does not answer" becomes a fact with a time on it.
 *
 * The file cannot replace the process, that is the point: when the hub is hung
 * or gone, the timestamp simply stops moving and anyone with a shell (or the
 * watcher script in tools/) can see how long ago it was written. A clean stop
 * writes `state: "stopped"` so a deliberate restart is not mistaken for a hang.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var config = require('./config');

var MAKER = 'cleanframe';

function make(file, intervalMs) {
  var every = intervalMs || 30000;
  var started = new Date().toISOString();
  var timer = null;

  function write(extra) {
    var body = {
      maker: MAKER,
      pid: process.pid,
      started: started,
      last: new Date().toISOString(),
      intervalSeconds: Math.round(every / 1000),
      state: 'running'
    };
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k]; }
    try {
      config.mkdirp(path.dirname(file));
      var tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(body, null, 1));
      fs.renameSync(tmp, file);   /* atomic: a reader never sees half a file */
    } catch (e) {
      console.log('[heartbeat] could not write ' + file + ': ' + e.message);
    }
    return body;
  }

  function read() {
    var raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* Seconds since the last write, and whether that is too long. Three
   * intervals of slack: one missed tick is a busy machine, not a hang. */
  function age() {
    var h = read();
    if (!h || !h.last) return { read: false, entry: null, seconds: null, stale: true, limit: Math.round(every * 3 / 1000) };
    var seconds = Math.max(0, Math.round((Date.now() - Date.parse(h.last)) / 1000));
    var limit = Math.round(every * 3 / 1000);
    return { read: true, entry: h, seconds: seconds, stale: seconds > limit, limit: limit };
  }

  return {
    file: file,
    intervalSeconds: Math.round(every / 1000),
    write: write,
    read: read,
    age: age,
    start: function (extra) {
      if (timer) clearInterval(timer);
      write(extra);
      timer = setInterval(function () { write(extra); }, every);
      if (timer.unref) timer.unref();
    },
    stop: function () {
      if (timer) { clearInterval(timer); timer = null; }
      var h = read() || {};
      write({ state: 'stopped', stopped: new Date().toISOString(), wasStarted: h.started || started });
    }
  };
}

module.exports = { make: make, MAKER: MAKER };
