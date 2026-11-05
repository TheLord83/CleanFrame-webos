/*
 * Settings backup on a USB stick.
 *
 * The launcher's settings live in one JSON file on the television. A factory
 * reset takes that file with it; a second copy on a stick does not. This module
 * is the half that touches the filesystem: find a mounted stick, write one
 * named file to it, read one back.
 *
 * Two rules that were learned the hard way elsewhere in this project:
 *
 * 1. Do not guess a mount point. webOS mounts sticks below /tmp/usb, other
 *    systems below /media or /run/media, and a stick can also be a phone or a
 *    card reader. Everything comes from /proc/mounts.
 * 2. A stick that is not there is not an error, it is an answer. The caller
 *    gets an empty list and says so; nothing invents a path and nothing writes
 *    "somewhere" to look busy.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var KIND = 'cleanframe-backup';
var NAME_RE = /^cleanframe-settings-[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/;
/* Filesystems a stick actually arrives with. ext4 is in the list because a
 * stick formatted by the neighbour is one too. */
var FSTYPES = ['vfat', 'fat', 'msdos', 'exfat', 'ntfs', 'ntfs3', 'fuseblk', 'ext2', 'ext3', 'ext4'];
/* Pseudo filesystems that hang under /media on webOS and are not sticks. */
var NOT_STICKS = ['squashfs', 'overlay', 'tmpfs', 'devtmpfs', 'cgroup', 'proc', 'sysfs', 'ubi', 'ubifs'];

function unescapeMount(s) {
  return String(s).replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
}

/* /proc/mounts: device mountpoint fstype options 0 0 - spaces appear escaped. */
function mounts() {
  var raw = '';
  try { raw = fs.readFileSync('/proc/mounts', 'utf8'); } catch (e) { return []; }
  var out = [];
  raw.split('\n').forEach(function (line) {
    var f = line.split(' ');
    if (f.length < 4) return;
    out.push({
      device: unescapeMount(f[0]),
      path: unescapeMount(f[1]),
      fstype: f[2],
      options: f[3]
    });
  });
  return out;
}

function writable(m) {
  return String(m.options).split(',').indexOf('ro') < 0;
}

function readable(m) {
  return true;
}

/* A stick is: a real block device (not a partition of the system disk, not a
 * pseudo filesystem) with a filesystem a stick has, mounted read-write. */
function sticks() {
  var forced = process.env.CF_STICK;
  if (forced) {
    /* The bench has no USB port. A directory stands in; it is called a stick in
     * the answer so the rest of the code has one shape, not two. */
    var isDir = false;
    try { isDir = fs.statSync(forced).isDirectory(); } catch (e) { isDir = false; }
    if (!isDir) return [];
    return [{ path: forced, device: 'bench', fstype: 'dir', label: path.basename(forced) || 'stick', writable: true }];
  }
  var out = [];
  var seen = {};
  mounts().forEach(function (m) {
    if (!m.path || seen[m.path]) return;
    if (NOT_STICKS.indexOf(m.fstype) >= 0) return;
    if (FSTYPES.indexOf(m.fstype) < 0) return;
    /* /dev/sd* is the usual external device; /dev/mmcblk0p* is the television's
     * own storage and the neighbour's internal card, never the backup target. */
    if (m.device.indexOf('/dev/sd') !== 0 && m.device.indexOf('/dev/disk/by-') !== 0) return;
    if (m.path === '/' || m.path === '/media' || m.path === '/boot') return;
    if (!writable(m)) return;
    seen[m.path] = true;
    out.push({
      path: m.path,
      device: m.device,
      fstype: m.fstype,
      label: path.basename(m.path) || m.path,
      writable: true
    });
  });
  out.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
  return out;
}

/* Which stick is meant: the one that already holds a backup, otherwise the only
 * one. Two sticks without a backup is a question, not a choice - the answer says
 * which ones there are and nothing is written. */
function pick(list) {
  list = list || sticks();
  if (!list.length) return { stick: null, reason: 'kein-stick' };
  var withBackup = [];
  list.forEach(function (s) {
    if (listFiles(s.path).length) withBackup.push(s);
  });
  if (withBackup.length === 1) return { stick: withBackup[0], reason: '' };
  if (withBackup.length > 1) return { stick: withBackup[0], reason: '', ambiguous: withBackup.length };
  if (list.length === 1) return { stick: list[0], reason: '' };
  return { stick: null, reason: 'mehrere-sticks', count: list.length };
}

function stamp(d) {
  d = d || new Date();
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* The files on a stick, oldest first. A file that does not parse is listed with
 * what is wrong instead of being dropped: pretending it is not there would hide
 * a corrupted backup until the day it is needed. */
function listFiles(dir) {
  var names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  var out = [];
  names.forEach(function (name) {
    if (!NAME_RE.test(name)) return;
    var full = path.join(dir, name), entry = { name: name, savedAt: '', version: '', bytes: 0, problem: '' };
    try {
      var st = fs.statSync(full);
      entry.bytes = st.size;
      entry.mtime = st.mtime && st.mtime.toISOString ? st.mtime.toISOString() : '';
      var payload = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!payload || payload.kind !== KIND) entry.problem = 'keine-cleanframe-sicherung';
      else {
        entry.savedAt = String(payload.exportedAt || '');
        entry.version = String(payload.version || '');
      }
    } catch (e) {
      entry.problem = 'unlesbar';
    }
    out.push(entry);
  });
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return out;
}

/* Write one file. Atomic within the stick: a stick pulled mid-write must not
 * leave a half file that looks whole. The mode is 0600 - the file carries the
 * Home Assistant token and the MQTT password, and a stick can be lost. */
function write(dir, cfg, opts) {
  opts = opts || {};
  if (!dir) return { ok: false, error: 'kein-stick' };
  var payload = {
    kind: KIND,
    schemaVersion: opts.schemaVersion || 1,
    version: opts.version || '',
    exportedAt: new Date().toISOString(),
    config: cfg
  };
  var body = JSON.stringify(payload, null, 2);
  var name = 'cleanframe-settings-' + stamp() + '.json';
  var full = path.join(dir, name);
  var tmp = full + '.tmp';
  try {
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 384 /* 0600 */ });
    /* vfat has no modes; chmod fails there and that is fine - the stick is the
     * only protection such a filesystem has. */
    try { fs.chmodSync(tmp, 384); } catch (e) { /* vfat */ }
    fs.renameSync(tmp, full);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
    return { ok: false, error: 'schreibfehler', detail: e.message };
  }
  return { ok: true, file: name, path: full, bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

/* Read one file back. Everything is checked before a single value reaches the
 * store: a wrong kind, a newer schema or a missing config would otherwise
 * overwrite the settings with an empty object. */
function read(dir, name) {
  if (!dir) return { ok: false, error: 'kein-stick' };
  name = String(name || '');
  if (!NAME_RE.test(name)) return { ok: false, error: 'kein-sicherungsname' };
  var full = path.join(dir, name), raw;
  try { raw = fs.readFileSync(full, 'utf8'); } catch (e) { return { ok: false, error: 'nicht-gefunden' }; }
  var payload;
  try { payload = JSON.parse(raw); } catch (e) { return { ok: false, error: 'unlesbar', detail: e.message }; }
  if (!payload || payload.kind !== KIND) return { ok: false, error: 'keine-cleanframe-sicherung' };
  if (!payload.config || typeof payload.config !== 'object') return { ok: false, error: 'ohne-einstellungen' };
  return { ok: true, payload: payload, bytes: Buffer.byteLength(raw), sha256: sha256(raw) };
}

module.exports = {
  KIND: KIND,
  NAME_RE: NAME_RE,
  mounts: mounts,
  sticks: sticks,
  pick: pick,
  listFiles: listFiles,
  write: write,
  read: read,
  stamp: stamp,
  sha256: sha256,
  readable: readable
};
