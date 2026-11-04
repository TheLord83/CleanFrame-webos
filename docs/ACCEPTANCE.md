# Acceptance — CleanFrame 0.6.38

The sheet that belongs to one device round. Five points, each with what has to be
true before you start and what counts as passed. Decided on the device, by the
owner of the television — not by a tool and not by a session.

This file is the text the lock prints: a writing tool that is pointed at a real
device without `--release-ok` refuses and shows this header plus the command to
repeat. One source, two uses.

## What is being accepted

| | |
|---|---|
| Version | 0.6.38 (`VERSION`, `app/appinfo.json`, `web/server.js`, `web/assets/index.html`) |
| Commit | `e1bc3e5` on `main` |
| Package | `dist/cleanframe_0.6.38_all.ipk`, 8 460 762 bytes |
| Archive SHA256 | `b3425064ddccf115c089dcb23e0085398103fd8f8b3580acab4c0dd8117b84a0` |
| Content hash | `2cc38cef8515032b9799530988afef2f03c263c0d7b17ce499a9c479e674e7e1` (app/, 190 files) |
| Previously published | 0.5.8 |

The archive hash is a snapshot: `tools/build-ipk.py` stamps the build time into
every tar entry, so a rebuild of the same content has a different archive hash.
The **content hash** (`python3 tools/app-content-hash.py`) is stable across
rebuilds — that is the one to compare if you are unsure whether the package in
your hand is the one that was tested.

## The bench before the device

`tools/check-all.sh` has to be green (`All checks passed`, exit 0) — it covers
the key handling, the picker behaviour, the layout against the stage, the hub and
the package. What it cannot cover: the remote in your hand, readability from the
sofa, and a real weather request. Those are the four points below.

## The five points

### 1. List — up/down picks, no side button

*Before:* Settings → Weather opens; the first row shows a value; a place is set,
so the weather can be on.
*Do:* OK on "Shown as", then down twice, then up once, then OK.
*Passed when:* down moves **inside** the open answer list and selects the next
answer ("Symbol und Temperatur" among them), up goes back inside the list the
same way, the next question is only reached once the list has ended, and neither
step needs the left/right button.

### 2. Without a place — "Off" is the only value

*Before:* the hub knows no place (browser: delete the place, or start from a fresh
configuration).
*Do:* open Settings → Weather and look at the "Shown as" row; press down, then OK
on another answer.
*Passed when:* the row stands on "Off", the reason ("Set the place first. Until
then the weather stays off.") is readable underneath, and OK on another answer
opens the place list instead of switching on a line that would stay empty.

### 3. Place — a list, not a text field

*Before:* at least one place is known to the hub (browser, `http://<tv>:8484/`,
Weather → place field: type a town, pick the hit, save).
*Do:* Settings → Weather → "Place" → OK, then down/OK.
*Passed when:* the row opens a **list** of the places the hub knows (no keyboard,
no text field on the device), down/OK sets one, the row shows it afterwards, and
the weather line then shows a real value.

### 4. QR code — right of the text, readable

*Before:* the setup note is reachable (Settings → "Run setup again", or the hub
page on the phone).
*Do:* look at the note, read the QR code with a phone.
*Passed when:* the code sits to the **right** of the text, not on top of it, and
a phone opens the address that is printed underneath it.

### 5. Inputs — the list the TV reports, honest states, and a real switch

*Before:* at least one HDMI socket is in use (the reference TV: HDMI 1 with a
streaming box, HDMI 3 empty).
*Do:* Settings → Inputs, open the row, read the three entries, then OK on an
empty socket and come back.
*Passed when:* the list holds exactly the HDMI sockets (no `SIMPLINK`, no `URCU`),
each entry carries the state the TV really reported — **Aktiv** for the running
one, **Verbunden** for a socket with a device, **Kein Gerät** for an empty one —
and OK on an entry switches the television to it.

## Results of the round (04.11.2026, LG Nano779PA / webOS 6.5)

The bench was green before the round — 16 stages, 28 checks — and still the device
found three faults. That is the reason this sheet exists.

| Point | Result | What the device showed |
|---|---|---|
| 1. List | passed | Weather row opens its answers underneath; down/up move inside the list |
| 2. Without a place | passed | Row stands on "Off" with the reason; OK on another answer opens the place list |
| 3. Place | passed after a fix | Place list showed `undefined` on a blank page (see finding 1); after 0.6.38: three places, the applied one marked, OK on "Hamburg, DE" stored place **and** coordinates (53.5511 / 9.9937) |
| 4. QR code | passed | Code sits right of the text, address readable underneath |
| 5. Inputs | passed after a fix | See findings 2 and 3; after 0.6.38: Google OTT (Aktiv), HDMI 2 (Verbunden), HDMI 3 (Kein Gerät), and OK on HDMI 2 switched the set |

Three findings, all three only visible on the device:

1. **The place sheet was a blank page saying "undefined".** `place` sat twice in
   the same object literal (`FRAMES` plus an empty copy in `FILLS`); the later key
   wins, so the frame function was `undefined` and that string went into
   `innerHTML`. Caught by `tools/test-place-sheet.js` (9 checks) from then on.
2. **The input calls never reached the TV.** The method was passed inside the
   payload (`{method, parameters}`) instead of in the URI, so every call ran into
   its eight-second timeout and the page reported "no inputs" while the service
   was running (`ps` showed `eim` alive). Guarded by `tools/check-luna-uris.py` —
   the bench has no Luna, so only a static check can catch this shape.
3. **Two empty HDMI sockets were called "Verbunden".** The page read
   `d.connected !== false` and `d.active`; the TV sends `connected: true` only for
   an attached device and marks the running input with `activate`. Pinned by
   `tools/test-inputs-page.js` (9 checks) with the answer measured on the device.

## After the round

Passed: note it in the release notes and in the AFFiNE entry for the day; the
version may then be published (archive + `repo.json` as assets, tag `v<version>`).
Failed: the point goes back as a finding with what the device did, not with what
the bench says — the bench was green by definition, that is why we are here.

The lock in `tools/lib/tvguard.py` stays in place for every later round: a
television is released per run, with `--release-ok="<date> <occasion>"`, and never
by an exported variable.
