/*
 * Konfigurationsspeicher fuer den CleanFrame-Config-Server.
 *
 * Eine JSON-Datei, atomar geschrieben (tmp + rename), mit Schema-Version.
 * Kein Zustand ausserhalb dieser Datei: der Launcher liest dieselbe Quelle
 * spaeter ueber die HTTP-API, die Web-Oberflaeche schreibt sie.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var VERSION = 1;

/* Erlaubte Werte werden hier geprueft, nicht in der Oberflaeche: die API ist
 * oeffentlich erreichbar, also muss der Server selbst validieren. */
var LANGS = ['de', 'en', 'system'];
var LAYOUTS = ['dock', 'list'];
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
      clock: true
    },
    home: [],
    integrations: {
      ha: { url: '', token: '' },
      mqtt: { url: '', user: '', password: '', prefix: 'cleanframe' }
    },
    createdAt: null,
    updatedAt: null
  };
}

function isStr(v, max) {
  return typeof v === 'string' && v.length <= (max || 240);
}

function oneOf(v, allowed, fallback) {
  return allowed.indexOf(v) >= 0 ? v : fallback;
}

/* Ein Startseiten-Eintrag: appId plus optionale Anzeige-Aenderungen.
 * `name` und `icon` sind die einzigen Felder, die die App umbenennen bzw.
 * umgestalten — der Katalog in "Alle Apps" bleibt davon unberuehrt. */
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

  cfg.lang = oneOf(src.lang, LANGS, 'system');

  var look = src.look && typeof src.look === 'object' ? src.look : {};
  cfg.look.layout = oneOf(look.layout, LAYOUTS, 'dock');
  cfg.look.apps = oneOf(look.apps, DOCK_MODES, 'both');
  if (isStr(look.wall, 120) && look.wall) cfg.look.wall = look.wall;
  if (isStr(look.font, 60) && look.font) cfg.look.font = look.font;
  cfg.look.clock = look.clock === undefined ? true : !!look.clock;

  if (Array.isArray(src.home)) {
    var seen = {};
    src.home.slice(0, 40).forEach(function (raw) {
      var e = cleanEntry(raw);
      if (!e || seen[e.appId]) return;
      seen[e.appId] = true;
      cfg.home.push(e);
    });
  }

  var integ = src.integrations && typeof src.integrations === 'object' ? src.integrations : {};
  var ha = integ.ha && typeof integ.ha === 'object' ? integ.ha : {};
  cfg.integrations.ha.url = isStr(ha.url, 300) ? ha.url : '';
  cfg.integrations.ha.token = isStr(ha.token, 400) ? ha.token : '';
  var mq = integ.mqtt && typeof integ.mqtt === 'object' ? integ.mqtt : {};
  cfg.integrations.mqtt.url = isStr(mq.url, 300) ? mq.url : '';
  cfg.integrations.mqtt.user = isStr(mq.user, 120) ? mq.user : '';
  cfg.integrations.mqtt.password = isStr(mq.password, 200) ? mq.password : '';
  cfg.integrations.mqtt.prefix = isStr(mq.prefix, 60) && mq.prefix ? mq.prefix : 'cleanframe';

  cfg.createdAt = isStr(src.createdAt, 40) && src.createdAt ? src.createdAt : null;
  return cfg;
}

/* Tokens und Passwoerter verlassen den Server nicht, wenn die Oberflaeche
 * liest — sie erfaehrt nur, ob etwas hinterlegt ist. Geschrieben werden sie
 * weiterhin vollstaendig. */
function redact(cfg) {
  var out = JSON.parse(JSON.stringify(cfg));
  var ha = out.integrations.ha;
  var mq = out.integrations.mqtt;
  out.integrations.ha = { url: ha.url, token: '', hasToken: !!ha.token };
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
  cfg.createdAt = before.createdAt || new Date().toISOString();
  cfg.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  var tmp = this.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 384 /* 0600 */ });
  fs.renameSync(tmp, this.file);
  return cfg;
};

module.exports = {
  VERSION: VERSION,
  LANGS: LANGS,
  LAYOUTS: LAYOUTS,
  DOCK_MODES: DOCK_MODES,
  defaults: defaults,
  validate: validate,
  redact: redact,
  Store: Store
};
