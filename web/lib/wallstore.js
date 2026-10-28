/*
 * Own wallpapers — the pictures the operator uploads in the settings page.
 *
 * They cannot live in the app package: /usr/palm/applications is read-only for
 * the user the launcher runs as, and a package would have to be rebuilt for
 * every new photo. So they sit next to the configuration, in /var/lib/cleanframe
 * (overridable with CF_WALL_USER_DIR for tests), and are served by the hub.
 *
 * The browser crops to 1920x1080 before uploading, and the server checks that
 * size again. Not out of distrust alone: the television has to draw the picture
 * on every start, and a 6000-pixel holiday photo would be decoded on the TV on
 * every wake-up. What arrives here is already the size the screen needs.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var config = require('./config');   /* mkdirp: node 8 on the TV has no recursive option */

var DIR = process.env.CF_WALL_USER_DIR || '/var/lib/cleanframe/walls';
var INDEX = path.join(DIR, 'index.json');
var MAX_BYTES = 6 * 1024 * 1024;
var WIDTH = 1920, HEIGHT = 1080;

function ensureDir() {
  config.mkdirp(DIR);
}

function readIndex() {
  try {
    var list = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeIndex(list) {
  ensureDir();
  fs.writeFileSync(INDEX, JSON.stringify(list, null, 1));
}

/* Only ids this module produced: no path is ever built from a request string. */
function validId(id) {
  return /^w[a-z0-9]{8,24}$/.test(String(id || ''));
}

function newId() {
  var s = '';
  while (s.length < 12) s += Math.random().toString(36).slice(2);
  return 'w' + s.slice(0, 12);
}

/* Size straight from the file header: PNG in bytes 16..24, JPEG in the first
 * SOFn marker. Enough for a guard, and it cannot be fooled by the browser's
 * declared width/height the way an <img> would in the page. */
function dimensions(buf, kind) {
  if (kind === 'png') {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  var i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    var marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    var len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/* Takes the data URL the browser sends, returns {id} or {error}. */
function save(name, dataUrl) {
  var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Nur JPEG oder PNG, und zwar als data:-URL.' };
  var kind = m[1] === 'image/png' ? 'png' : 'jpeg';
  var buf;
  try { buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64'); } catch (e) { return { error: 'Bild ist kein Base64.' }; }
  if (!buf || !buf.length) return { error: 'Bild ist leer.' };
  if (buf.length > MAX_BYTES) return { error: 'Bild ist groesser als 6 MB.' };
  var dim = dimensions(buf, kind);
  if (!dim) return { error: 'Bildformat nicht lesbar.' };
  if (dim.w !== WIDTH || dim.h !== HEIGHT) {
    return { error: 'Bild muss ' + WIDTH + 'x' + HEIGHT + ' sein, ist ' + dim.w + 'x' + dim.h + '.' };
  }
  var id = newId();
  var ext = kind === 'png' ? '.png' : '.jpg';
  ensureDir();
  fs.writeFileSync(path.join(DIR, id + ext), buf);
  var list = readIndex();
  list.push({
    id: id,
    name: String(name || 'Eigenes Bild').slice(0, 60),
    file: id + ext,
    kind: kind,
    bytes: buf.length,
    added: new Date().toISOString()
  });
  writeIndex(list);
  return { id: id, entry: list[list.length - 1] };
}

function list() {
  return readIndex().filter(function (e) { return validId(e.id); });
}

function get(id) {
  if (!validId(id)) return null;
  var hit = null;
  list().forEach(function (e) { if (e.id === id) hit = e; });
  return hit;
}

function fileOf(id) {
  var e = get(id);
  if (!e) return null;
  var f = path.join(DIR, e.file || (id + '.jpg'));
  /* Belt and braces: the file name comes from our own index, but a tampered
   * index.json must not be able to point outside the directory. */
  return f.indexOf(DIR) === 0 ? f : null;
}

function remove(id) {
  var e = get(id);
  if (!e) return false;
  var list2 = readIndex().filter(function (x) { return x.id !== id; });
  writeIndex(list2);
  try { fs.unlinkSync(path.join(DIR, e.file || (id + '.jpg'))); } catch (err) { /* already gone */ }
  return true;
}

module.exports = {
  save: save, list: list, get: get, fileOf: fileOf, remove: remove,
  validId: validId, DIR: DIR, WIDTH: WIDTH, HEIGHT: HEIGHT, MAX_BYTES: MAX_BYTES
};
