#!/usr/bin/env node
/*
 * Checks the interface translations.
 *
 *  1. assets/lang/de.js and assets/lang/en.js are loaded in a sandbox (no
 *     browser needed) and their key sets are compared in both directions —
 *     a key that only exists on one side is a bug, not a fallback.
 *  2. Every t('key') reference in assets/index.html must exist in both files.
 *
 * Prints one machine-readable line, `RESULT <passed>/<total>`, so
 * tools/check-all.sh can treat a silent run as a failure.
 *
 * Usage: node tools/check-lang.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var DE = path.join(ROOT, 'web', 'assets', 'lang', 'de.js');
var EN = path.join(ROOT, 'web', 'assets', 'lang', 'en.js');
var HTML = path.join(ROOT, 'web', 'assets', 'index.html');

function loadLang(file) {
  var sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  var bag = sandbox.window.CF_LANG || {};
  var lang = path.basename(file, '.js');
  return bag[lang] || null;
}

function keysOf(obj) {
  return Object.keys(obj || {}).sort();
}

function main() {
  var de, en;
  try {
    de = loadLang(DE);
    en = loadLang(EN);
  } catch (e) {
    console.log('cannot load language files: ' + e.message);
    console.log('RESULT 0/1');
    return 1;
  }
  if (!de || !en) {
    console.log('language files did not define window.CF_LANG.de / .en');
    console.log('RESULT 0/1');
    return 1;
  }

  var kd = keysOf(de), ke = keysOf(en);
  var union = {};
  kd.concat(ke).forEach(function (k) { union[k] = true; });
  var all = Object.keys(union).sort();

  var problems = 0;
  all.forEach(function (k) {
    var inDe = Object.prototype.hasOwnProperty.call(de, k);
    var inEn = Object.prototype.hasOwnProperty.call(en, k);
    if (!inDe) { console.log('missing in de: ' + k); problems++; }
    if (!inEn) { console.log('missing in en: ' + k); problems++; }
    if (inDe && inEn) {
      if (typeof de[k] !== 'string' || !de[k]) { console.log('empty or non-string de value: ' + k); problems++; }
      if (typeof en[k] !== 'string' || !en[k]) { console.log('empty or non-string en value: ' + k); problems++; }
      /* A German-looking English value is not proof, but identical long strings
       * that contain umlauts almost always mean "forgotten to translate". */
      if (de[k] === en[k] && /[äöüÄÖÜß]/.test(en[k])) {
        console.log('en value looks German: ' + k + ' = ' + JSON.stringify(en[k]));
        problems++;
      }
    }
  });

  /* Keys referenced from the interface. Comments are stripped first (they talk
   * about t('key')), and constructed keys are listed explicitly. */
  var html = fs.readFileSync(HTML, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  var refs = {};
  var re = /\bt\(\s*'([^']+)'/g, m;
  while ((m = re.exec(html)) !== null) {
    /* 'wiz.s' + (step + 1) + '.title' — a prefix, not a key */
    if (m[1].charAt(m[1].length - 1) === '.') continue;
    refs[m[1]] = true;
  }
  /* Drop constructed-key prefixes: something like 'wiz.s' is expanded below. */
  Object.keys(refs).forEach(function (r) {
    if (all.some(function (k) { return k.indexOf(r) === 0 && k !== r; })) delete refs[r];
  });
  for (var i = 1; i <= 5; i++) {
    refs['wiz.s' + i + '.title'] = true;
    refs['wiz.s' + i + '.hint'] = true;
  }
  var refList = Object.keys(refs).sort();
  var missingRefs = 0;
  refList.forEach(function (k) {
    var hasDe = Object.prototype.hasOwnProperty.call(de, k);
    var hasEn = Object.prototype.hasOwnProperty.call(en, k);
    if (!hasDe || !hasEn) {
      var where = (!hasDe && !hasEn) ? 'de+en' : (hasDe ? 'en' : 'de');
      console.log('referenced in index.html but missing in ' + where + ': ' + k);
      missingRefs++;
    }
  });

  // German text that sneaked back into the markup or the inline script. The
  // words below are the ones that were hardcoded before the language files
  // existed; a hit means a string was added without t('key').
  var germanWords = ['Startseite', 'Darstellung', 'Integrationen', 'Kachel', 'Einstellung',
    'Speichern', 'Fernseher', 'Akzente', 'Anordnung', 'Sprache', 'Bildschirmschoner',
    'Senioren', 'Prüfe', 'Bitte', 'hinzufügen', 'entfernen', 'Verbindung testen',
    'JS-Fehler', 'Fehler beim', 'noch keine'];
  var html = fs.readFileSync(HTML, 'utf8').split('\n');
  var germanHits = [];
  html.forEach(function (line, index) {
    // Text inside an element with data-t* is a fallback that the runtime
    // replaces in every language — German there is intended (default language).
    if (/data-t(-title|-aria|-alt|-ph)?=/.test(line)) return;
    germanWords.forEach(function (word) {
      if (line.indexOf(word) >= 0) germanHits.push((index + 1) + ': ' + word + ' -> ' + line.trim().slice(0, 90));
    });
  });
  germanHits.forEach(function (hit) { console.log('German text in index.html: ' + hit); });

  var total = all.length + refList.length + germanWords.length;
  var passed = total - problems - missingRefs - germanHits.length;

  console.log('');
  console.log('de keys: ' + kd.length + ', en keys: ' + ke.length +
              ' (union ' + all.length + '), referenced from index.html: ' + refList.length);
  console.log('identical key sets: ' + (problems === 0 && kd.length === ke.length ? 'yes' : 'NO'));
  console.log('german text in index.html: ' + (germanHits.length === 0 ? 'none' : germanHits.length + ' hit(s)'));
  console.log('');
  console.log('RESULT ' + Math.max(0, passed) + '/' + total);
  return problems + missingRefs + germanHits.length === 0 ? 0 : 1;
}

process.exit(main());
