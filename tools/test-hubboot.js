#!/usr/bin/env node
/* test-hubboot.js — the decisions in app/hubboot.js, without a TV.
 *
 * hubboot starts the bundled hub through the Homebrew service, but only when
 * nothing answers on 8484, and it stops only the copy it started itself. Both
 * rules are the whole point of the file, so both are checked here against a stub
 * of the browser pieces it uses (XMLHttpRequest, PalmServiceBridge, pagehide).
 *
 *   node tools/test-hubboot.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app', 'hubboot.js'), 'utf8');
var APP_DIR = '/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe';
var HUB = APP_DIR + '/hub';

var checks = 0, failures = [];
function ok(cond, what) { checks++; if (!cond) failures.push(what); }

function makeHarness(opts) {
  var state = {
    execCalls: [],
    healthAnswers: opts.healthAnswers.slice(),
    pagehide: [],
    logs: []
  };

  function FakeXHR() { this.readyState = 0; this.status = 0; }
  FakeXHR.prototype.open = function (method, url) { this.url = url; };
  FakeXHR.prototype.send = function () {
    var self = this, answer = state.healthAnswers.length ? state.healthAnswers.shift() : false;
    setTimeout(function () {
      self.readyState = 4;
      self.status = answer ? 200 : 0;
      if (self.onreadystatechange) self.onreadystatechange();
      if (!answer && self.onerror) self.onerror();
    }, opts.latency || 5);
  };

  function FakeBridge() {}
  FakeBridge.prototype.call = function (uri, payload) { this.uri = uri; this.payload = payload; state.lastCall = { uri: uri, payload: JSON.parse(payload) }; };

  var listeners = {};
  var sandbox = {
    console: { log: function (m) { state.logs.push(m); } },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    XMLHttpRequest: FakeXHR,
    PalmServiceBridge: FakeBridge,
    location: { pathname: 'file://' + APP_DIR + '/index.html' },
    document: { addEventListener: function () {} },
    window: {
      location: { pathname: 'file://' + APP_DIR + '/index.html' },
      PalmServiceBridge: FakeBridge,
      addEventListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
    }
  };
  sandbox.window.window = sandbox.window;
  state.fire = function (name) { (listeners[name] || []).forEach(function (fn) { fn(); }); };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'hubboot.js' });

  // Every exec goes through the bridge; capture what was asked for.
  var realCall = FakeBridge.prototype.call;
  FakeBridge.prototype.call = function (uri, payload) {
    state.execCalls.push({ uri: uri, payload: JSON.parse(payload) });
    realCall.call(this, uri, payload);
    var cb = this.onservicecallback;
    if (cb) cb(JSON.stringify({ returnValue: true, stdoutString: 'started' }));
  };
  return { state: state, sandbox: sandbox };
}

function testPortBusy() {
  var h = makeHarness({ healthAnswers: [true] });
  return new Promise(function (resolve) {
    setTimeout(function () {
      ok(h.state.execCalls.length === 0, 'a hub that already answers must not be started again');
      h.state.fire('pagehide');
      ok(h.state.execCalls.length === 0, 'nothing was started, so nothing may be stopped');
      resolve();
    }, 120);
  });
}

function testStartAndStop() {
  // First probe fails, then the poll finds the hub up.
  var h = makeHarness({ healthAnswers: [false, false, true] });
  return new Promise(function (resolve) {
    setTimeout(function () {
      ok(h.state.execCalls.length === 1, 'one exec call when the port is free, got ' + h.state.execCalls.length);
      var call = h.state.execCalls[0] || { uri: '', payload: {} };
      ok(call.uri === 'luna://org.webosbrew.hbchannel.service/exec', 'the Homebrew service is what starts it, got ' + call.uri);
      var cmd = String((call.payload || {}).command || '');
      ok(cmd.indexOf('H="' + HUB + '"') >= 0, 'the command knows the bundled hub directory: ' + cmd);
      ok(cmd.indexOf('"$H/server.js"') >= 0, 'and starts the server from there');
      ok(cmd.indexOf('CF_PORT=8484') >= 0, 'port 8484 is passed explicitly');
      ok(cmd.indexOf('CF_CONFIG="/var/lib/cleanframe/config.json"') >= 0, 'the configuration is the same file a permanent hub would use');
      ok(cmd.indexOf('setsid') >= 0, 'the process is detached where setsid exists');
      h.state.fire('pagehide');
      var last = h.state.execCalls[h.state.execCalls.length - 1] || { payload: {} };
      var stopCmd = String((last.payload || {}).command || '');
      ok(h.state.execCalls.length === 2, 'exactly one stop call, got ' + h.state.execCalls.length);
      ok(stopCmd.indexOf('pkill -f "' + HUB + '/server.js"') === 0, 'the stop targets only the bundled copy: ' + stopCmd);
      resolve();
    }, 900);
  });
}

function testNoHomebrewService() {
  // health never answers and exec reports failure: the app must survive this.
  var h = makeHarness({ healthAnswers: [false, false, false, false, false, false, false, false, false, false] });
  return new Promise(function (resolve) {
    var ready = false;
    h.sandbox.window.CleanFrameHubBoot.whenReady(function () { ready = true; });
    setTimeout(function () {
      ok(h.state.execCalls.length === 1, 'it tries once, not in a loop');
      ok(ready, 'whenReady still fires, so the launcher does not hang');
      resolve();
    }, 2600);
  });
}

Promise.resolve()
  .then(testPortBusy)
  .then(testStartAndStop)
  .then(testNoHomebrewService)
  .then(function () {
    if (failures.length) {
      failures.forEach(function (f) { console.log('  FAIL ' + f); });
      console.log('RESULT ' + (checks - failures.length) + '/' + checks);
      process.exit(1);
    }
    console.log('RESULT ' + checks + '/' + checks);
  });
