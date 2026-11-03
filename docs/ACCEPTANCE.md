# Acceptance — CleanFrame 0.6.32

The sheet that belongs to one device round. Four points, each with what has to be
true before you start and what counts as passed. Decided on the device, by the
owner of the television — not by a tool and not by a session.

This file is the text the lock prints: a writing tool that is pointed at a real
device without `--release-ok` refuses and shows this header plus the command to
repeat. One source, two uses.

## What is being accepted

| | |
|---|---|
| Version | 0.6.32 (`VERSION`, `app/appinfo.json`, `web/server.js`) |
| Commit | `6ea6e3e` on `main` |
| Package | `dist/cleanframe_0.6.32_all.ipk`, 8 455 660 bytes |
| Archive SHA256 | `c3e5088514eae05c49af5fa1011db0af3c16b4a30cdaf211f48ccdd4904c10de` |
| Content hash | `30de44d2938d2aaf6ab227a78970e23f14e813ab5824d99c8646afbd45999b02` (app/, 190 files) |
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

## The four points

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

## After the round

Passed: note it in the release notes and in the AFFiNE entry for the day; the
version may then be published (archive + `repo.json` as assets, tag `v<version>`).
Failed: the point goes back as a finding with what the device did, not with what
the bench says — the bench was green by definition, that is why we are here.

The lock in `tools/lib/tvguard.py` stays in place for every later round: a
television is released per run, with `--release-ok="<date> <occasion>"`, and never
by an exported variable.
