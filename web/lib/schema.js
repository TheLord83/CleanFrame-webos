/*
 * Options schema for the web interface.
 *
 * The values must match the constants in the launcher (main.js:
 * LOOK_VALUES, FONTS, WALLS, LANGS, SCREENSAVER variants). Hence a single
 * description here, served as /api/schema — the interface builds its select
 * fields from it instead of maintaining the lists twice.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var WALLS_FILE = path.join(__dirname, '..', 'assets', 'walls.json');

var SCHEMA = {
  version: 1,
  langs: [
    { id: 'system', name: 'Wie der Fernseher' },
    { id: 'de', name: 'Deutsch' },
    { id: 'en', name: 'English' }
  ],
  look: {
    bg: [
      { id: 'photo', name: 'Foto (Hintergrundbild)' },
      { id: 'dark', name: 'Dunkel' },
      { id: 'light', name: 'Hell' }
    ],
    layout: [
      { id: 'dock', name: 'Leiste unten' },
      { id: 'list', name: 'Liste' }
    ],
    apps: [
      { id: 'both', name: 'Symbol und Text' },
      { id: 'icons', name: 'Nur Symbole' },
      { id: 'text', name: 'Nur Text' }
    ],
    controls: [
      { id: 'both', name: 'Symbol und Text' },
      { id: 'icons', name: 'Nur Symbole' },
      { id: 'text', name: 'Nur Text' }
    ],
    focus: [
      { id: 'glass', name: 'Glas' },
      { id: 'type', name: 'Nur Schrift' }
    ],
    material: [
      { id: 'soft', name: 'Weich' },
      { id: 'frost', name: 'Frost' },
      { id: 'tint', name: 'Farbton' }
    ],
    fonts: [
      { id: 'manrope', name: 'Manrope' }
    ]
  },
  screensaver: {
    minutes: { min: 1, max: 120, step: 1 },
    variants: [
      { id: '', name: 'Der Fernseher entscheidet' },
      { id: 'clock', name: 'Uhr' },
      { id: 'gallery', name: 'Galerie' }
    ]
  },
  ui: {
    textScale: { min: 50, max: 200, step: 5 },
    cursor: [
      { id: 'focus', name: 'Rahmen um die Auswahl' },
      { id: 'off', name: 'Kein Rahmen' }
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
    return { id: w.id, name: w.name, tone: w.tone || '', thumb: '/api/wall/' + w.id };
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
