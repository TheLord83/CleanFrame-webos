#!/usr/bin/env node
/*
 * Welche Einhängepunkte als Stick gelten (#16) - ohne Fernseher und ohne USB-Port.
 *
 * Der Grund für diese Prüfung steht am Gerät: ein 244-GB-Stick mit NTFS wird vom
 * Fernseher mit seinem eigenen Treiber eingehängt und steht in /proc/mounts als
 * `tntfs`. In der Liste der Stick-Dateisysteme stand nur `ntfs`, also meldete die
 * Seite "Kein Stick gefunden", während der Stick eingesteckt und beschreibbar war.
 *
 * Deshalb nimmt `sticks(list)` jetzt eine Mount-Tabelle entgegen. Der Prüfstand
 * gibt Tabellen vor, die es auf einem Entwicklungsrechner nicht gibt (webOS-Pfade
 * unter /tmp/usb, die eigene Platte des Fernsehers, schreibgeschützt eingehängt) -
 * und prüft, was daraus wird, statt zu hoffen, dass die Dateisystemliste stimmt.
 *
 *   node tools/test-stick-fs.js
 */
'use strict';

var stick = require('../web/lib/stick.js');

/* Ohne CF_STICK will der normale Weg /proc/mounts lesen; die Prüfung braucht den
 * übergebenen Tisch, nicht den echten. */
delete process.env.CF_STICK;

var passed = 0, failed = 0, problems = [];

function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; problems.push(what); console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}

function m(device, path, fstype, options) {
  return { device: device, path: path, fstype: fstype, options: options || 'rw,relatime' };
}

function pathsOf(list) {
  return list.map(function (s) { return s.path; });
}

/* Die drei Zeilen sind aus /proc/mounts des Fernsehers abgeschrieben. */
var TV = [
  m('/dev/mmcblk0p54', '/media', 'ext4'),
  m('/dev/mmcblk0p53', '/mnt/lg/cache/sdp', 'ext4'),
  m('/dev/loop0', '/media/squashfs/apps/youtube.leanback.v4', 'squashfs', 'ro,relatime'),
  m('tmpfs', '/mnt/lg/cache/sdp/sdx/pkgs', 'tmpfs'),
  m('overlay', '/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4', 'overlay')
];

/* 1. Der Fall, der am Gerät danebenging: NTFS über webOS. */
var ntfs = stick.sticks(TV.concat([m('/dev/sda1', '/tmp/usb/sda/sda1', 'tntfs', 'rw,relatime,nls=utf8,fail_safe')]));
check(ntfs.length === 1, 'eine tntfs-Einhängung ist ein Stick', String(ntfs.length));
check(ntfs[0] && ntfs[0].path === '/tmp/usb/sda/sda1', 'und der Pfad ist der aus /proc/mounts', ntfs[0] && ntfs[0].path);
check(ntfs[0] && ntfs[0].device === '/dev/sda1', 'mit dem Gerät, nicht einem geratenen Pfad', ntfs[0] && ntfs[0].device);
check(ntfs[0] && ntfs[0].fstype === 'tntfs', 'und dem Dateisystem, das dort steht', ntfs[0] && ntfs[0].fstype);

/* 2. Die gewöhnlichen Formate bleiben es. */
['vfat', 'exfat', 'ntfs', 'ext4'].forEach(function (fs) {
  var got = stick.sticks(TV.concat([m('/dev/sdb1', '/media/usb', fs)]));
  check(got.length === 1 && got[0].fstype === fs, fs + ' gilt weiterhin als Stick', String(got.length));
});

/* 3. Die eigene Platte des Fernsehers ist kein Stick, auch wenn ext4 passt. */
var own = stick.sticks(TV);
check(own.length === 0, 'die eigene Platte (mmcblk0p54 auf /media) zählt nicht', JSON.stringify(pathsOf(own)));

/* 4. Schreibgeschützt eingehängt ist kein Ziel für eine Sicherung. */
var ro = stick.sticks(TV.concat([m('/dev/sda1', '/tmp/usb/sda/sda1', 'tntfs', 'ro,relatime')]));
check(ro.length === 0, 'ein ro eingehängter Stick fällt heraus', JSON.stringify(pathsOf(ro)));
check(stick.sticks(TV.concat([m('/dev/sda1', '/x', 'vfat', 'rw,ro')])).length === 0,
  'auch wenn ro nur in der Liste steht');

/* 5. Pseudo-Dateisysteme unter /media bleiben draußen, auch mit Blockgerät. */
check(stick.sticks(TV.concat([m('/dev/loop7', '/media/x', 'squashfs')])).length === 0,
  'squashfs unter /media ist kein Stick');
check(stick.sticks(TV.concat([m('tmpfs', '/tmp/usb/x', 'tmpfs')])).length === 0,
  'tmpfs unter /tmp/usb ist kein Stick');
check(stick.sticks(TV.concat([m('/dev/mmcblk0p54', '/tmp/usb/fake', 'ext4')])).length === 0,
  'nur /dev/sd* und /dev/disk/by-* kommen infrage');

/* 6. Zwei Sticks ohne Sicherung sind eine Frage, keine Wahl. */
var two = stick.sticks(TV.concat([m('/dev/sda1', '/tmp/usb/a/sda1', 'tntfs'), m('/dev/sdb1', '/tmp/usb/b/sdb1', 'vfat')]));
check(two.length === 2, 'zwei Sticks werden beide gesehen', String(two.length));
var picked = stick.pick(two);
check(picked.stick === null, 'ohne Sicherung wird keiner gewählt');
check(picked.reason === 'mehrere-sticks', 'und der Grund heißt so', picked.reason);
check(picked.count === 2, 'mit der Anzahl daneben', String(picked.count));

/* 7. Ein Stick allein wird ohne Rückfrage genommen. */
var one = stick.sticks(TV.concat([m('/dev/sda1', '/tmp/usb/sda/sda1', 'tntfs')]));
var single = stick.pick(one);
check(single.stick && single.stick.path === '/tmp/usb/sda/sda1', 'ein einzelner Stick wird genommen');
check(single.reason === '', 'ohne Grund zum Klagen', "'" + single.reason + "'");

/* 8. Kein Stick ist eine Antwort, kein Fehler. */
var none = stick.pick([]);
check(none.stick === null && none.reason === 'kein-stick', 'kein Stick meldet kein-stick', none.reason);

console.log('');
console.log('RESULT ' + passed + '/' + (passed + failed));
if (failed) {
  console.log('FAILED: ' + problems.join(' | '));
  process.exit(1);
}
