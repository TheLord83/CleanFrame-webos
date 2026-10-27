/*
 * Configuration store for the CleanFrame config server.
 *
 * A single JSON file, written atomically (tmp + rename), with a schema version.
 * No state outside this file: the launcher reads the same source later over the
 * HTTP API, and the web interface writes it.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var VERSION = 1;

/* node 8 on the TV does not know fs.mkdirSync(p, {recursive:true}). */
function mkdirp(dir) {
  var parts = String(dir).split('/').filter(Boolean);
  var cur = '';
  if (String(dir).charAt(0) === '/') cur = '/';
  parts.forEach(function (part) {
    cur = cur === '/' ? '/' + part : (cur ? cur + '/' + part : part);
    try { fs.mkdirSync(cur); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  });
}

/* Allowed values are checked here, not in the interface: the API is publicly
 * reachable, so the server itself has to validate. */
var LANGS = ['de', 'en', 'system'];
var LAYOUTS = ['dock', 'list'];
/* Complete set of display axes of the launcher (see web/lib/schema.js). */
var BGS = ['photo', 'dark', 'light'];
var FOCUS = ['glass', 'type'];
var MATERIALS = ['soft', 'frost', 'tint'];
var DOCK_MODES = ['both', 'icons', 'text'];

function defaults() {
  return {
    schemaVersion: VERSION,
    lang: 'system',
    look: {
      layout: 'dock',
      apps: 'both',
      wall: 'misty',
      font: 'manrope',
      clock: true,
      clock24: true
    },
    home: [],
    /* Screensaver coupling: after N minutes of idleness the launcher starts the
     * TV screensaver itself. Empty `variant` = Glasshouse default. */
    screensaver: { enabled: false, minutes: 10, variant: '' },
    /* Accessibility: senior mode (large type, fewer tiles) and a scaled text
     * size. The launcher evaluates both. */
    ui: { senior: false, textScale: 100, cursor: 'focus' },
    /* First start: the wizard runs in the web interface until it is dismissed. */
    onboarding: { done: false, version: 1 },
    integrations: {
      ha: { url: '', token: '' },
      mqtt: { url: '', user: '', password: '', prefix: 'cleanframe' },
      /* Weather: one line next to the clock, fetched by the hub so the
       * television never talks to the internet itself. Coordinates only, the
       * place name is a label for the settings page. */
      /* Immer Celsius. Eine Einheitenwahl war der eine Schalter zu viel: wer
       * Fahrenheit liest, will es meist nicht selbst eingeschaltet haben. */
      weather: { enabled: false, place: '', lat: 0, lon: 0, line: 'temp',
                 style: 'icon-temp', size: 'normal', quiet: true, pos: 'right' }
    },
    createdAt: null,
    updatedAt: null
  };
}

/* Numbers from JSON can arrive as strings, and NaN must not reach the
 * weather call. Clamped, because a coordinate outside the range is a bug. */
function isNum(v, min, max) {
  var n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function isStr(v, max) {
  return typeof v === 'string' && v.length <= (max || 240);
}

function oneOf(v, allowed, fallback) {
  return allowed.indexOf(v) >= 0 ? v : fallback;
}

/* A home screen entry: appId plus optional display overrides.
 * `name` and `icon` are the only fields that rename or restyle the app —
 * the catalog under "All apps" stays untouched by them. */
function cleanEntry(e) {
  if (!e || !isStr(e.appId, 200) || !e.appId) return null;
  var out = { appId: e.appId };
  if (isStr(e.name, 120) && e.name) out.name = e.name;
  if (isStr(e.icon, 200) && e.icon) out.icon = e.icon;
  if (isStr(e.url, 500) && e.url) out.url = e.url;
  return out;
}

function validate(input) {
  var cfg = defaults();
  var src = input && typeof input === 'object' ? input : {};

  /* Pass the revision number through (see Store.write) — the launcher detects
   * changes coming from the web interface by it. */
  cfg.rev = parseInt(src.rev, 10) || 0;
  cfg.lang = oneOf(src.lang, LANGS, 'system');

  var look = src.look && typeof src.look === 'object' ? src.look : {};
  cfg.look.bg = oneOf(look.bg, BGS, 'photo');
  cfg.look.controls = oneOf(look.controls, DOCK_MODES, 'both');
  cfg.look.focus = oneOf(look.focus, FOCUS, 'glass');
  cfg.look.material = oneOf(look.material, MATERIALS, 'soft');
  cfg.look.layout = oneOf(look.layout, LAYOUTS, 'dock');
  cfg.look.apps = oneOf(look.apps, DOCK_MODES, 'both');
  if (isStr(look.wall, 120) && look.wall) cfg.look.wall = look.wall;
  if (isStr(look.font, 60) && look.font) cfg.look.font = look.font;
  cfg.look.clock = look.clock === undefined ? true : !!look.clock;
  /* 24-hour display is the default (Europe); 12 hours only on request. */
  cfg.look.clock24 = look.clock24 === undefined ? true : !!look.clock24;

  if (Array.isArray(src.home)) {
    var seen = {};
    src.home.slice(0, 40).forEach(function (raw) {
      var e = cleanEntry(raw);
      if (!e || seen[e.appId]) return;
      seen[e.appId] = true;
      cfg.home.push(e);
    });
  }

  var scr = src.screensaver && typeof src.screensaver === 'object' ? src.screensaver : {};
  cfg.screensaver.enabled = !!scr.enabled;
  var mins = parseInt(scr.minutes, 10);
  cfg.screensaver.minutes = isFinite(mins) ? Math.min(120, Math.max(1, mins)) : 10;
  if (isStr(scr.variant, 40)) cfg.screensaver.variant = scr.variant;

  var ui = src.ui && typeof src.ui === 'object' ? src.ui : {};
  cfg.ui.senior = !!ui.senior;
  var scale = parseInt(ui.textScale, 10);
  cfg.ui.textScale = isFinite(scale) ? Math.min(200, Math.max(50, scale)) : 100;
  cfg.ui.cursor = oneOf(ui.cursor, ['focus', 'off'], 'focus');

  var onb = src.onboarding && typeof src.onboarding === 'object' ? src.onboarding : {};
  cfg.onboarding.done = !!onb.done;
  var ov = parseInt(onb.version, 10);
  cfg.onboarding.version = isFinite(ov) ? ov : 1;

  var integ = src.integrations && typeof src.integrations === 'object' ? src.integrations : {};
  var ha = integ.ha && typeof integ.ha === 'object' ? integ.ha : {};
  cfg.integrations.ha.url = isStr(ha.url, 300) ? ha.url : '';
  cfg.integrations.ha.token = isStr(ha.token, 400) ? ha.token : '';
  cfg.integrations.ha.entities = [];
  if (Array.isArray(ha.entities)) {
    var seenE = {};
    ha.entities.slice(0, 12).forEach(function (e) {
      var id = typeof e === 'string' ? e : (e && e.id);
      if (!isStr(id, 120) || !/^[a-z_]+\.[a-z0-9_]+$/.test(id) || seenE[id]) return;
      seenE[id] = true;
      /* `shown` lets the TV hide a chosen value without dropping it from the
       * selection - the hub keeps offering it, the strip just skips it. */
      cfg.integrations.ha.entities.push({ id: id, label: isStr(e && e.label, 60) ? e.label : '',
                                         shown: !(e && e.shown === false) });
    });
  }
  var mq = integ.mqtt && typeof integ.mqtt === 'object' ? integ.mqtt : {};
  cfg.integrations.mqtt.url = isStr(mq.url, 300) ? mq.url : '';
  cfg.integrations.mqtt.user = isStr(mq.user, 120) ? mq.user : '';
  cfg.integrations.mqtt.password = isStr(mq.password, 200) ? mq.password : '';
  cfg.integrations.mqtt.prefix = isStr(mq.prefix, 60) && mq.prefix ? mq.prefix : 'cleanframe';

  var we = integ.weather && typeof integ.weather === 'object' ? integ.weather : {};
  cfg.integrations.weather = {
    enabled: we.enabled === true,
    place: isStr(we.place, 80) ? we.place : '',
    lat: isNum(we.lat, -90, 90),
    lon: isNum(we.lon, -180, 180),
    line: we.line === 'highlow' ? 'highlow' : 'temp',
    /* Wie die Zeile aussieht. Symbol zuerst, weil ein Strich neben der Uhr
     * weniger Aufmerksamkeit zieht als ein Wort. */
    style: ['icon', 'icon-temp', 'icon-temp-text', 'temp-text'].indexOf(we.style) >= 0 ? we.style : 'icon-temp',
    size: ['small', 'normal', 'large'].indexOf(we.size) >= 0 ? we.size : 'normal',
    quiet: we.quiet !== false,
    /* Wo die Zeile steht: neben der Uhr rechts, links davon, darunter oder am
     * rechten Rand der Beschriftungsflaeche. */
    pos: ['left', 'right', 'below', 'end'].indexOf(we.pos) >= 0 ? we.pos : 'right'
  };

  cfg.createdAt = isStr(src.createdAt, 40) && src.createdAt ? src.createdAt : null;
  return cfg;
}

/* Tokens and passwords do not leave the server when the interface reads —
 * it only learns whether something is stored. Writing still stores them
 * in full. */
function redact(cfg) {
  var out = JSON.parse(JSON.stringify(cfg));
  var ha = out.integrations.ha;
  var mq = out.integrations.mqtt;
  out.integrations.ha = { url: ha.url, token: '', hasToken: !!ha.token, entities: ha.entities || [] };
  out.integrations.mqtt = {
    url: mq.url, user: mq.user, password: '', prefix: mq.prefix, hasPassword: !!mq.password
  };
  return out;
}

function Store(file) {
  this.file = file;
}

Store.prototype.read = function () {
  var raw = null;
  try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { raw = null; }
  if (!raw) {
    var fresh = defaults();
    fresh.createdAt = new Date().toISOString();
    return fresh;
  }
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = {}; }
  var cfg = validate(parsed);
  if (!cfg.createdAt) cfg.createdAt = new Date().toISOString();
  return cfg;
};

Store.prototype.write = function (input) {
  var cfg = validate(input);
  var before = this.read();
  /* Revision conflict: whoever holds an older revision (e.g. the app with the
   * revision it last applied) must not overwrite the newer version. The
   * interface wins, the caller reloads. */
  var claim = input && input.rev;
  var current = parseInt(before.rev, 10) || 0;
  /* rev 0 or no value means "no claim" (e.g. fresh start, import). */
  if (claim !== undefined && claim !== null && claim !== '' &&
      (parseInt(claim, 10) || 0) > 0 && parseInt(claim, 10) < current) {
    var err = new Error('config veraltet');
    err.code = 'CONFLICT';
    err.rev = current;
    throw err;
  }
  cfg.createdAt = before.createdAt || new Date().toISOString();
  /* Revision number: every save increments it. The launcher polls it
   * regularly and applies changes from the web interface immediately. */
  cfg.rev = (parseInt(before.rev, 10) || 0) + 1;
  cfg.updatedAt = new Date().toISOString();
  mkdirp(path.dirname(this.file));
  var tmp = this.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 384 /* 0600 */ });
  fs.renameSync(tmp, this.file);
  return cfg;
};

module.exports = {
  VERSION: VERSION,
  mkdirp: mkdirp,
  LANGS: LANGS,
  LAYOUTS: LAYOUTS,
  BGS: BGS,
  FOCUS: FOCUS,
  MATERIALS: MATERIALS,
  DOCK_MODES: DOCK_MODES,
  defaults: defaults,
  validate: validate,
  redact: redact,
  Store: Store
};
