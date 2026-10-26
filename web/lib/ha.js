/*
 * Home Assistant integration for tiles and status values.
 *
 * Reading and switching: the entities the user picks in the web interface are
 * fetched over the Home Assistant REST API, and the ones with a simple on/off
 * can be toggled from the strip. Everything else stays display-only - a cover
 * needs up/stop/down and a lock needs a question, neither fits a single button.
 * The token stays on the TV; here it is only used for requests.
 */
'use strict';

var http = require('http');
var https = require('https');
var urlmod = require('url');

/* Domains that make sense on a tile. Everything else (automations, zones,
 * persons) is not offered: it has no display value. */
var USEFUL = {
  sensor: 'Sensor', binary_sensor: 'Binärsensor', light: 'Licht', switch: 'Schalter',
  climate: 'Klima', media_player: 'Medien', cover: 'Rollladen', weather: 'Wetter',
  person: 'Person', input_boolean: 'Schalter', fan: 'Ventilator', vacuum: 'Sauger',
  lock: 'Schloss', device_tracker: 'Gerät', sun: 'Sonne', update: 'Update'
};

function parseBase(raw) {
  var u = urlmod.parse(raw || '');
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  var basePath = (u.pathname || '').replace(/\/+$/, '');
  return {
    lib: u.protocol === 'https:' ? https : http,
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    base: basePath,
    secure: u.protocol === 'https:'
  };
}

function request(cfg, method, path, body, timeout, cb) {
  var b = parseBase((cfg && cfg.url) || '');
  if (!b) return cb({ ok: false, error: 'URL ungültig' });
  var token = (cfg && cfg.token) || '';
  var payload = body ? Buffer.from(JSON.stringify(body)) : null;
  var headers = { 'Accept': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = payload.length;
  }
  var req = b.lib.request({
    host: b.host, port: b.port, path: b.base + path, method: method,
    headers: headers, timeout: timeout || 5000, rejectUnauthorized: false
  }, function (res) {
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { data += c; if (data.length > 8 * 1024 * 1024) req.abort(); });
    res.on('end', function () {
      var parsed = null;
      try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
      cb({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed, raw: data.slice(0, 400) });
    });
  });
  req.on('timeout', function () { req.abort(); cb({ ok: false, error: 'timeout' }); });
  req.on('error', function (e) { cb({ ok: false, error: e.code || String(e) }); });
  if (payload) req.write(payload);
  req.end();
}

function friendly(state) {
  var a = state.attributes || {};
  var name = a.friendly_name || state.entity_id;
  var unit = a.unit_of_measurement || '';
  /* 'unknown' and 'unavailable' stay as they are: the interface translates them,
   * and a bare dash hides whether the sensor is missing or just has no reading. */
  var value = state.state;
  /* Numbers are rounded for the display: Home Assistant delivers long floats
   * (26.9494692484538 %) that no one wants to read on a television. */
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    var num = parseFloat(value);
    if (isFinite(num)) value = Math.abs(num) >= 100 ? String(Math.round(num)) : String(Math.round(num * 10) / 10);
  }
  if (typeof value === 'string' && value.length > 24) value = value.slice(0, 24) + '…';
  return { id: state.entity_id, name: name, state: value, unit: unit, domain: state.entity_id.split('.')[0] };
}

/* List for the selection in the web interface: only domains with a display
 * value, alphabetically, grouped by domain. */
function entities(cfg, cb) {
  request(cfg, 'GET', '/api/states', null, 6000, function (r) {
    if (!r.ok) return cb({ ok: false, error: r.error || ('HTTP ' + r.status), entities: [] });
    if (!Array.isArray(r.data)) return cb({ ok: false, error: 'unerwartete Antwort von Home Assistant', entities: [] });
    var out = [];
    r.data.forEach(function (s) {
      if (!s || !s.entity_id) return;
      var domain = s.entity_id.split('.')[0];
      if (!USEFUL[domain]) return;
      var f = friendly(s);
      f.domainLabel = USEFUL[domain];
      out.push(f);
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    cb({ ok: true, count: out.length, entities: out.slice(0, 3000) });
  });
}

/* Values for the selected entities — that is what the tile shows. */
function values(cfg, ids, cb) {
  var list = (ids || []).slice(0, 12);
  if (!list.length) return cb({ ok: true, values: [] });
  request(cfg, 'GET', '/api/states', null, 6000, function (r) {
    if (!r.ok) return cb({ ok: false, error: r.error || ('HTTP ' + r.status), values: [] });
    if (!Array.isArray(r.data)) return cb({ ok: false, error: 'unerwartete Antwort', values: [] });
    var byId = {};
    r.data.forEach(function (s) { if (s && s.entity_id) byId[s.entity_id] = friendly(s); });
    cb({ ok: true, values: list.map(function (id) { return byId[id] || { id: id, name: id, state: 'unknown', unit: '' }; }) });
  });
}

/* Domains where one button is enough: the tile switches, nothing else. */
var SWITCHABLE = { light: 'Licht', switch: 'Schalter', input_boolean: 'Schalter', fan: 'Ventilator' };

/* Switch an entity. cb gets {ok, entity_id, state} - the state comes from Home
 * Assistant's answer, so the strip can show the new value without asking twice. */
function toggle(cfg, entityId, cb) {
  var id = String(entityId || '').trim();
  var domain = id.split('.')[0];
  if (id.indexOf('.') < 1) return cb({ ok: false, error: 'keine Entitaet angegeben' });
  if (!Object.prototype.hasOwnProperty.call(SWITCHABLE, domain)) {
    return cb({ ok: false, error: 'diese Entitaet laesst sich hier nicht schalten (' + domain + ')' });
  }
  request(cfg, 'POST', '/api/services/' + domain + '/toggle', { entity_id: id }, 6000, function (r) {
    if (!r.ok) return cb({ ok: false, error: r.error || ('HTTP ' + r.status) });
    var changed = Array.isArray(r.data) ? r.data : [];
    var hit = changed.filter(function (s) { return s && s.entity_id === id; })[0] || changed[0] || null;
    cb({ ok: true, entity_id: id, state: hit ? hit.state : null });
  });
}

module.exports = { entities: entities, values: values, toggle: toggle, request: request, USEFUL: USEFUL, SWITCHABLE: SWITCHABLE };
