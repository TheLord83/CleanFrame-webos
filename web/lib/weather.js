/*
 * weather.js - one line of weather, without an account.
 *
 * Open-Meteo needs no key and no registration, which is the whole reason for
 * using it here: the television talks to the hub, the hub talks to one public
 * endpoint, and nothing identifies the user beyond the coordinates.
 *
 * The place is resolved once by name (geocoding) and then stored as numbers, so
 * the forecast call does not depend on that service staying reachable.
 *
 * Node 8.12 on the television: no fetch, no promises in the request path.
 */
var https = require('https');
var plainHttp = require('http');

var BASE = process.env.CF_WEATHER_BASE || 'https://api.open-meteo.com';
var GEO = process.env.CF_WEATHER_GEO || 'https://geocoding-api.open-meteo.com';

/* Open-Meteo's own numbers. Only the ones that can actually appear in Germany
 * matter here; everything else is "cloudy", which is a fair summary. */
var DESCRIPTIONS = {
  0: { en: 'clear', de: 'klar' },
  1: { en: 'mostly clear', de: 'meist klar' },
  2: { en: 'partly cloudy', de: 'teils bewölkt' },
  3: { en: 'overcast', de: 'bedeckt' },
  45: { en: 'fog', de: 'Nebel' },
  48: { en: 'fog', de: 'Nebel' },
  51: { en: 'drizzle', de: 'Nieselregen' },
  53: { en: 'drizzle', de: 'Nieselregen' },
  55: { en: 'drizzle', de: 'Nieselregen' },
  61: { en: 'rain', de: 'Regen' },
  63: { en: 'rain', de: 'Regen' },
  65: { en: 'heavy rain', de: 'Starkregen' },
  71: { en: 'snow', de: 'Schnee' },
  73: { en: 'snow', de: 'Schnee' },
  75: { en: 'heavy snow', de: 'starker Schnee' },
  77: { en: 'snow', de: 'Schnee' },
  80: { en: 'showers', de: 'Schauer' },
  81: { en: 'showers', de: 'Schauer' },
  82: { en: 'heavy showers', de: 'Starkschauer' },
  85: { en: 'snow showers', de: 'Schneeschauer' },
  86: { en: 'snow showers', de: 'Schneeschauer' },
  95: { en: 'thunderstorm', de: 'Gewitter' },
  96: { en: 'thunderstorm', de: 'Gewitter' },
  99: { en: 'thunderstorm', de: 'Gewitter' }
};

function describe(code, lang) {
  var d = DESCRIPTIONS[code];
  if (!d) return lang === 'de' ? 'bewölkt' : 'cloudy';
  return lang === 'de' ? d.de : d.en;
}

function getJson(base, pathAndQuery, cb) {
  /* http is allowed so the checks can point at a local stub, and so an own
   * proxy in front of Open-Meteo stays possible. */
  var client = base.indexOf('http://') === 0 ? plainHttp : https;
  var req = client.get(base + pathAndQuery, function (res) {
    if (res.statusCode !== 200) {
      res.resume();
      return cb(new Error('upstream answered ' + res.statusCode));
    }
    var chunks = [], size = 0;
    res.on('data', function (c) {
      size += c.length;
      /* A forecast is a few kilobytes; anything large is not an answer. */
      if (size > 200000) { req.abort(); return cb(new Error('answer too large')); }
      chunks.push(c);
    });
    res.on('end', function () {
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { cb(new Error('unreadable answer')); }
    });
  });
  req.on('error', function (e) { cb(e); });
  req.setTimeout(8000, function () { req.abort(); cb(new Error('timeout')); });
}

/* One forecast per place, at most every fifteen minutes. The television asks
 * more often than that (it redraws the clock every minute) and does not need a
 * newer answer than the hour the forecast is for anyway. */
var CACHE_MS = 15 * 60 * 1000;
var cache = { key: '', at: 0, value: null };

function forecast(weather, lang, cb) {
  var lat = Number(weather.lat), lon = Number(weather.lon);
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
    return cb(null, { ok: true, enabled: false, error: 'no place set' });
  }
  var unit = weather.unit === 'f' ? 'fahrenheit' : 'celsius';
  var key = lat + ',' + lon + ',' + unit + ',' + (lang === 'de' ? 'de' : 'en');
  if (cache.value && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return cb(null, cache.value);
  }
  var q = '/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current_weather=true&daily=temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=1&temperature_unit=' + unit;
  getJson(BASE, q, function (err, data) {
    if (err) return cb(err);
    var cur = data && data.current_weather;
    if (!cur || typeof cur.temperature !== 'number') return cb(new Error('no current weather in the answer'));
    var daily = data.daily || {};
    var value = {
      ok: true,
      enabled: true,
      celsius: unit === 'celsius',
      temp: Math.round(cur.temperature),
      code: cur.weathercode,
      text: describe(cur.weathercode, lang),
      high: Array.isArray(daily.temperature_2m_max) ? Math.round(daily.temperature_2m_max[0]) : null,
      low: Array.isArray(daily.temperature_2m_min) ? Math.round(daily.temperature_2m_min[0]) : null,
      at: new Date().toISOString()
    };
    cache = { key: key, at: Date.now(), value: value };
    cb(null, value);
  });
}

function geocode(name, lang, cb) {
  var q = (name || '').trim();
  if (q.length < 2) return cb(new Error('name too short'));
  getJson(GEO, '/v1/search?name=' + encodeURIComponent(q) + '&count=1&language=' + (lang === 'de' ? 'de' : 'en') + '&format=json', function (err, data) {
    if (err) return cb(err);
    var hit = data && Array.isArray(data.results) && data.results[0];
    if (!hit) return cb(new Error('place not found'));
    cb(null, {
      name: [hit.name, hit.country_code].filter(Boolean).join(', '),
      lat: Math.round(hit.latitude * 10000) / 10000,
      lon: Math.round(hit.longitude * 10000) / 10000
    });
  });
}

/* Forgets the cached answer, for when the place or the unit changed. */
function reset() { cache = { key: '', at: 0, value: null }; }

module.exports = { forecast: forecast, geocode: geocode, describe: describe, reset: reset, CACHE_MS: CACHE_MS };
