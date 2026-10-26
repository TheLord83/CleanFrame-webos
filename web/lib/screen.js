/*
 * Whole-screen capture on the TV — through the webOS capture service.
 *
 * Why not the framebuffer: /dev/fb0 exists but reading it fails ("No such device"), the device
 * is held by surface-manager. Why not DevTools: that only sees the web app.
 *
 * The service call, measured on webOS 6.5 (43NANO779PA):
 *   luna://com.webos.service.capture/executeOneShot
 *   {"path": ..., "method": "DISPLAY", "format": "PNG", "width": 1920, "height": 1080}
 *   -> {"returnValue": true, "capturedWidth": 1920, "capturedHeight": 1080, "writtenBytes": 1319297}
 *
 * The service name from most guides, com.webos.service.tv.capture, does not exist on this
 * firmware ("Service does not exist"), so it is only tried as a fallback.
 *
 * Two things to know about luna-send: called in the foreground over a pipe it prints nothing at
 * all, so the reply goes to a file and is read from there; and it has to run detached, otherwise
 * the call blocks the caller for no reason.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;

var LUNA = process.env.CF_LUNA_SEND || '/usr/bin/luna-send';
var SERVICES = (process.env.CF_CAPTURE_SERVICE ||
  'com.webos.service.capture,com.webos.service.tv.capture').split(',');
var DIR = process.env.CF_SHOT_DIR || '/tmp';
var STUB = process.env.CF_SCREENSHOT_STUB || '';   /* tests: write a placeholder instead */

var FORMATS = { PNG: 'png', JPG: 'jpg', BMP: 'bmp' };

/* A 1x1 PNG, so the tests can check the whole path without a TV. */
var STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

function stamp() {
  var d = new Date();
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' +
    two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '-' +
    String(d.getMilliseconds());
}

function sizeOf(file) {
  try {
    var st = fs.statSync(file);
    return st.isFile() ? st.size : 0;
  } catch (e) {
    return 0;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * capture({width, height, format}, cb) -> cb(err, {file, bytes, width, height, service, tookMs})
 */
function capture(opts, cb) {
  opts = opts || {};
  var started = Date.now();
  var format = String(opts.format || 'PNG').toUpperCase();
  if (!FORMATS[format]) format = 'PNG';
  var width = parseInt(opts.width || 1920, 10) || 1920;
  var height = parseInt(opts.height || 1080, 10) || 1080;

  var name = 'cf-screen-' + stamp() + '.' + FORMATS[format];
  var file = path.join(DIR, name);
  var reply = path.join(DIR, name + '.json');

  if (STUB) {
    try {
      fs.writeFileSync(file, STUB_PNG);
    } catch (e) {
      return cb(e);
    }
    return cb(null, { file: file, bytes: sizeOf(file), width: width, height: height,
      service: 'stub', tookMs: Date.now() - started });
  }

  var services = SERVICES.slice();
  var attempts = [];

  function tryNext() {
    var service = services.shift();
    if (!service) {
      var reason = attempts.join('; ') || 'no answer from the capture service';
      return cb(new Error(reason));
    }
    var payload = JSON.stringify({ path: file, method: 'DISPLAY', format: format,
      width: width, height: height });
    var child;
    try {
      child = spawn(LUNA, ['-n', '1', '-f', 'luna://' + service + '/executeOneShot', payload],
        { detached: true, stdio: ['ignore', fs.openSync(reply, 'w'), fs.openSync(reply, 'a')] });
    } catch (e) {
      attempts.push(service + ': ' + e.message);
      return tryNext();
    }
    child.unref();

    /* The service writes the file while it answers, so "size > 0" means nothing: the first
     * version of this handed out 64 KB of a 1.3 MB picture. Wait until the reply names the
     * written size and the file has reached it. */
    var waited = 0;
    var lastSize = -1;
    var stable = 0;
    var timer = setInterval(function () {
      waited += 150;
      var bytes = sizeOf(file);
      var answer = readJson(reply) || {};
      var complete = answer.returnValue && answer.writtenBytes &&
        bytes >= parseInt(answer.writtenBytes, 10);
      if (bytes > 0 && bytes === lastSize) stable += 1; else stable = 0;
      lastSize = bytes;

      if (complete || (stable >= 3 && bytes > 0 && answer.returnValue)) {
        clearInterval(timer);
        return cb(null, {
          file: file, bytes: bytes,
          width: answer.capturedWidth || width,
          height: answer.capturedHeight || height,
          service: service, tookMs: Date.now() - started
        });
      }
      if (waited >= 8000) {
        clearInterval(timer);
        attempts.push(service + ': ' + (answer.errorText ||
          ('file stopped at ' + bytes + ' bytes')));
        return tryNext();
      }
    }, 150);
  }

  tryNext();
}

/** Remove a capture from /tmp (the web interface keeps no history). */
function forget(file) {
  if (!file || STUB) return;
  try {
    if (path.dirname(file) === path.resolve(DIR)) {
      fs.unlinkSync(file);
      fs.unlinkSync(file + '.json');
    }
  } catch (e) { /* already gone */ }
}

exports.capture = capture;
exports.forget = forget;
exports.FORMATS = Object.keys(FORMATS);
