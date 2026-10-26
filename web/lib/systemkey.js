/*
 * Real remote control for the whole TV — including LG's own menus.
 *
 * Why this detour: webOS only accepts button presses on the SSAP pointer socket
 * (ssap://com.webos.service.networkinput/getPointerInputSocket) from a client that
 * was paired with CONTROL_MOUSE_AND_KEYBOARD. Our own key does not have that
 * permission, and this firmware shows no pairing prompt at all (measured: no dialog
 * on screen, the connection is closed without a key). Home Assistant, however, is
 * already paired with this TV — so we use its `webostv.button` service. The TV keeps
 * one pairing, no second dialog.
 *
 * Fallback order in the server: launcher keys (DevTools, fast) first, then this.
 * Stays silent and harmless when Home Assistant is not configured.
 */
'use strict';

var ha = require('./ha');

/* Our key names -> names the webOS remote control understands. */
var BUTTONS = {
  up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', ok: 'ENTER',
  back: 'BACK', menu: 'MENU', exit: 'EXIT', info: 'INFO', home: 'HOME',
  play: 'PLAY', pause: 'PAUSE', stop: 'STOP', mute: 'MUTE',
  volup: 'VOLUMEUP', voldown: 'VOLUMEDOWN',
  chup: 'CHANNELUP', chdown: 'CHANNELDOWN',
  red: 'RED', green: 'GREEN', yellow: 'YELLOW', blue: 'BLUE',
  num0: '0', num1: '1', num2: '2', num3: '3', num4: '4',
  num5: '5', num6: '6', num7: '7', num8: '8', num9: '9'
};

var entityCache = { id: '', at: 0 };

function buttonName(key) {
  if (BUTTONS[key]) return BUTTONS[key];
  if (/^[0-9]$/.test(String(key))) return String(key);
  return '';
}

/* Find the TV entity once per five minutes: an LG media_player from the webostv integration. */
function findEntity(cfg, cb) {
  if (cfg && cfg.tvEntity) return cb(null, cfg.tvEntity);
  var now = Date.now();
  if (entityCache.id && now - entityCache.at < 300000) return cb(null, entityCache.id);
  /* ha.request answers with a single result object, not (err, res). */
  ha.request(cfg, 'GET', '/api/states', null, 6000, function (res) {
    if (!res || !res.ok || !Array.isArray(res.data)) return cb('Home Assistant antwortet nicht');
    /* Several entities can look like the TV (an old registration stays as `unavailable`
     * forever and swallows every press). Score them instead of taking the first hit. */
    var best = null;
    var bestScore = -1;
    res.data.forEach(function (st) {
      var eid = String(st.entity_id || '');
      if (eid.indexOf('media_player.') !== 0) return;
      var attrs = st.attributes || {};
      var name = String(attrs.friendly_name || '');
      var state = String(st.state || '');
      if (state === 'unavailable' || state === 'off' || state === 'unknown') return;
      var score = 0;
      if (/webos|lg/i.test(eid + ' ' + name)) score += 2;
      if (attrs.device_class === 'tv') score += 4;
      if (state === 'on' || state === 'playing' || state === 'idle') score += 3;
      if (score > bestScore) { bestScore = score; best = eid; }
    });
    if (!best || bestScore < 2) return cb('kein erreichbarer LG-Fernseher in Home Assistant');
    entityCache.id = best;
    entityCache.at = now;
    cb(null, best);
  });
}

/* Press keys one after another; the TV needs a moment between two presses. */
function press(keys, haCfg, cb) {
  if (!haCfg || !haCfg.url) return cb('Home Assistant ist nicht eingerichtet');
  var names = [];
  for (var i = 0; i < keys.length; i++) {
    var n = buttonName(keys[i]);
    if (!n) return cb('unbekannte Taste: ' + keys[i]);
    names.push(n);
  }
  findEntity(haCfg, function (e1, entity) {
    if (e1) return cb(e1);
    var idx = 0;
    var reply = { ok: false, entity: entity, pressed: [] };
    function next() {
      if (idx >= names.length) {
        reply.ok = true;
        return cb(null, reply);
      }
      var name = names[idx++];
      ha.request(haCfg, 'POST', '/api/services/webostv/button',
        { entity_id: entity, button: name }, 8000, function (res) {
          if (!res || !res.ok) {
            reply.error = (res && (res.raw || res.error)) || 'Home Assistant lehnt ab';
            return cb(reply.error, reply);
          }
          reply.pressed.push(name);
          setTimeout(next, 250);
        });
    }
    next();
  });
}

module.exports = { press: press, BUTTONS: BUTTONS, buttonName: buttonName };
