/*
 * Options schema for the web interface.
 *
 * The values must match the constants in the launcher (main.js:
 * LOOK_VALUES, FONTS, WALLS, LANGS, SCREENSAVER variants). Hence a single
 * description here, served as /api/schema — the interface builds its select
 * fields from it instead of maintaining the lists twice.
 *
 * `name` is German and is what the launcher on the TV reads — it must never
 * change. `nameEn` is additive and only used by the web interface when its own
 * language is English.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var WALLS_FILE = path.join(__dirname, '..', 'assets', 'walls.json');

var SCHEMA = {
  version: 1,
  langs: [
    { id: 'system', name: 'Wie der Fernseher', nameEn: 'Like the TV' },
    { id: 'de', name: 'Deutsch', nameEn: 'Deutsch' },
    { id: 'en', name: 'English', nameEn: 'English' }
  ],
  look: {
    bg: [
      { id: 'photo', name: 'Foto (Hintergrundbild)', nameEn: 'Photo (wallpaper)' },
      { id: 'dark', name: 'Dunkel', nameEn: 'Dark' },
      { id: 'light', name: 'Hell', nameEn: 'Light' }
    ],
    layout: [
      { id: 'dock', name: 'Leiste unten', nameEn: 'Bottom bar' },
      { id: 'list', name: 'Liste', nameEn: 'List' }
    ],
    apps: [
      { id: 'both', name: 'Symbol und Text', nameEn: 'Icon and text' },
      { id: 'icons', name: 'Nur Symbole', nameEn: 'Icons only' },
      { id: 'text', name: 'Nur Text', nameEn: 'Text only' }
    ],
    controls: [
      { id: 'both', name: 'Symbol und Text', nameEn: 'Icon and text' },
      { id: 'icons', name: 'Nur Symbole', nameEn: 'Icons only' },
      { id: 'text', name: 'Nur Text', nameEn: 'Text only' }
    ],
    focus: [
      { id: 'glass', name: 'Glas', nameEn: 'Glass' },
      { id: 'type', name: 'Nur Schrift', nameEn: 'Type only' }
    ],
    material: [
      { id: 'soft', name: 'Weich', nameEn: 'Soft' },
      { id: 'frost', name: 'Frost', nameEn: 'Frost' },
      { id: 'tint', name: 'Farbton', nameEn: 'Tint' }
    ],
    fonts: [
      { id: 'manrope', name: 'Manrope', nameEn: 'Manrope' }
    ]
  },
  screensaver: {
    minutes: { min: 1, max: 120, step: 1 },
    variants: [
      { id: '', name: 'Der Fernseher entscheidet', nameEn: 'Decided by the TV' },
      { id: 'clock', name: 'Uhr', nameEn: 'Clock' },
      { id: 'gallery', name: 'Galerie', nameEn: 'Gallery' }
    ]
  },
  ui: {
    textScale: { min: 50, max: 200, step: 5 },
    cursor: [
      { id: 'focus', name: 'Rahmen um die Auswahl', nameEn: 'Frame around the selection' },
      { id: 'off', name: 'Kein Rahmen', nameEn: 'No frame' }
    ]
  },
  home: { max: 12 }
};

function walls() {
  try {
    var raw = fs.readFileSync(WALLS_FILE, 'utf8');
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/* Complete schema including wallpapers (generated from the launcher catalog). */
function full() {
  var s = JSON.parse(JSON.stringify(SCHEMA));
  s.look.walls = walls().map(function (w) {
    return { id: w.id, name: w.name, nameEn: w.nameEn || w.name, tone: w.tone || '', thumb: '/api/wall/' + w.id };
  });
  return s;
}

/* Wallpaper file for an id (only file names from the catalog, no path built
 * from user input — prevents path traversal). */
function wallFile(id) {
  var hit = null;
  walls().forEach(function (w) { if (w.id === id) hit = w; });
  if (!hit || !hit.thumb) return null;
  return String(hit.thumb).replace(/^assets\/wallpapers\//, '');
}

module.exports = { full: full, wallFile: wallFile, SCHEMA: SCHEMA };
