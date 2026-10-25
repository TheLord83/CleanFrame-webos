/*
 * Optionsschema fuer die Web-Oberflaeche.
 *
 * Die Werte muessen zu den Konstanten im Launcher passen (main.js:
 * LOOK_VALUES, FONTS, WALLS, LANGS, SCREENSAVER-Varianten). Deshalb hier eine
 * einzige Beschreibung, die als /api/schema ausgeliefert wird — die Oberflaeche
 * baut ihre Auswahlfelder daraus, statt Listen doppelt zu pflegen.
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

/* Vollstaendiges Schema inklusive Wandbildern (aus dem Launcher-Katalog erzeugt). */
function full() {
  var s = JSON.parse(JSON.stringify(SCHEMA));
  s.look.walls = walls().map(function (w) {
    return { id: w.id, name: w.name, tone: w.tone || '', thumb: '/api/wall/' + w.id };
  });
  return s;
}

/* Wandbild-Datei zu einer ID (nur Dateinamen aus dem Katalog, kein Pfad-Bau
 * aus Nutzereingaben — verhindert Pfad-Ausbrueche). */
function wallFile(id) {
  var hit = null;
  walls().forEach(function (w) { if (w.id === id) hit = w; });
  if (!hit || !hit.thumb) return null;
  return String(hit.thumb).replace(/^assets\/wallpapers\//, '');
}

module.exports = { full: full, wallFile: wallFile, SCHEMA: SCHEMA };
