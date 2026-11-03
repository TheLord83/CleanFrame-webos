# Checks

Everything that can be checked without the TV runs with one command:

```bash
tools/check-all.sh
```

The script starts its own configuration server on port 8484 and a headless Chrome on port 9333, and
cleans both up at the end. `--keep` leaves them running so you can look for yourself.

## The layers

**1. Syntax.** `node --check` over every source file in `app/`, `web/`, `tools/` and
`tools/ref/`. The three reference probes in `tools/ref/` have to parse too — they are the basis of
the layout measurements, and a measuring tool that does not run any more is noticed by nobody until
somebody needs it.

**2. node 8.** `tools/check-node8.py`. The TV runs node 8.12, so anything that only exists in later
versions (`new URL`, `mkdirSync({recursive})`, `readBigUInt64BE`, the newer `http.get()` signature)
is caught here instead of crashing on the device. 10 checks.

**3. Icons.** `tools/check-icons.py` checks that every icon key in the configuration has a file and
every file a key. 43 icons.

**Gate.** `tools/test-tvguard.py` checks the lock that keeps the install tools away from an
unreleased television (`tools/lib/tvguard.py`, `docs/ACCEPTANCE.md`): loopback goes through, a LAN
address is refused with exit 78, `--release-ok` opens it and puts the occasion in the log, a name that
does not resolve is refused instead of trusted, reading tools only warn, and every writing tool calls
the guard. 26 checks, no network and no device — the addresses are refused before anything is sent.

**Release files.** `tools/check-repo-assets.py` builds a package into a temporary directory (never
into `dist/`), lets `tools/make-apps-json.py` write the repository file next to it and checks version,
size, hash and URL against that package. Then it compares the pinned `repo/apps.json` with the newest
tag — and with the package exactly once its version is the working one. Two files describing a
release, and until this stage nobody compared them: the stale `dist/repo.json` with 0.5.1 in it would
have gone through a real release unnoticed.

**4. Configuration server.** `tools/test-web-api.py` starts the server with a stub catalogue and a
temporary configuration, then checks every endpoint: `/api/health`, `/api/config` (GET, PUT, POST
with 403, 409 and 415), `/api/schema`, `/api/wall/<id>`, `/api/apps`, `/api/diag`, the Home
Assistant bridge including the rejected toggle, backup, `/api/tv/key` with a long press and the
weather line. 47 checks, six of them for the weather with a local Open-Meteo stand-in so the suite
never needs the network: off by default (and provably nothing fetched), rounded values with a word,
the fifteen-minute cache, the geocoding, an unknown place, and that a bad look setting falls back
instead of breaking while a stored Fahrenheit is dropped. Also: a backup that carries no secrets, a
connection check that refuses to hand the stored token
to a foreign URL, and a separate server instance that has to survive a missing `luna-send`.

## Interface

**Keys.** `tools/test-ui-keys.js` loads the home screen in Chrome, replaces the device layer with a
stub and sends real key presses through `Input.dispatchKeyEvent`. It covers navigation, context
menu, rename, language, clock format, settings pages and geometry: 26 checks.

**Live apply.** `tools/test-live-apply.js` exists because of the failures on 2026-10-25: a tile name
and icon stayed old because the rebuild key did not contain them, the wallpaper was set as a value
only and the image file stayed, and the text size was fixed in pixels. The test writes a fixed
starting configuration, changes it over HTTP and measures the visible result in the DOM:

- tile name in the list view
- icon change in the list view
- wallpaper: file name of the loaded image
- text size 150 % → 132 px
- senior mode at 100 % → 110 px, off → 88 px
- tile name in the bottom dock
- spinner in the web interface: runs, then stops

**Interface self-test.** `tools/check-selftest.py` opens the hub with `?selftest=ui` in a throwaway
tab. The page then clicks itself: add a tile, save it, read the configuration back, walk the wizard,
switch the language, and check that a stale tab only sends the fields it changed. 13 steps, reported
in the page title. It runs only outside CI, because the extra tab needs a browser that reaches the
test server.

**Status strip.** `tools/test-ha-strip.js` runs the home screen against a stub Home Assistant and
drives the real keys into the strip: `down` focuses a chip, `OK` toggles it and the second chip
carries no frame because a sensor cannot be switched, a hidden value loses its chip but keeps its
name in the settings page. 17 checks.

**Settings rows.** `tools/test-settings-rows.js` walks every page of the settings and reads the rows
out of the DOM: each row has to be a picker (a value in the row, the answers open underneath) or an
explicit action, with the expected number of answers. The expectation in the file is the state of
0.6.32; `want` is the goal — every selection row a picker, actions stay actions. `--report` prints
what still has to be migrated. A row the page shows but the expectation does not know is a failure,
and so is an expectation without a row: that is the case a fixed list never catches, and exactly how
the two interaction patterns of 0.6.32 came about. 86 checks.

**Bundled hub.** Two checks, because this is the piece a Channel install depends on.
`tools/test-hubboot.js` loads `app/hubboot.js` with stubbed browser pieces and proves the three
decisions: a hub that already answers on 8484 is not started a second time, a free port gets exactly
one start command that names the bundled `server.js` and detaches with `setsid`, and the stop command
matches only the copy inside the app directory, never a hub installed for good. `tools/check-ipk-hub.py`
builds a package and looks inside it: `hub/server.js`, `hub/lib/ha.js`, `hub/assets/index.html` and
`hubboot.js` have to be in there, and no `.pyc` or preview page. 13 and 7 checks.

**Links.** `tools/check-links.py` checks every relative link and anchor in the documentation, 65 of
them at the moment. A licence note with a dead link is not a typo, which is why this one runs in CI.

## Two rules, both learned from failures

**Measure the visible result, not the state.** The revision counter was already incremented while
the screen still showed the old content, which is why the bug went unnoticed. Every check waits for
the DOM, up to 12 seconds.

**A check without output is not a passed check.** `check-all.sh` counts a check as passed only when
it exits 0 and prints a machine-readable line:

```
RESULT <passed>/<total>
```

Both numbers must match. A human summary alone is not enough: a run that printed `0/9 passed` would
have counted as green. On 2026-10-25 the new test was missing the call to its main function, so the
script exited 0 without a single check and the run was green and worthless. The guard is proven:
`RESULT 8/9`, a missing `RESULT` line and exit code 1 each turn the layer red.

## What is not checked here

The device: installation, start, the real screen, the long-press threshold, the context menu from
the remote and the screensaver. That is `tools/install.sh` plus looking at the TV.

Glasshouse is replaced by a stub in the tests, because the real app list only exists on the device.

## What was removed

`tools/sweep-flow.py` walked the settings pages on the device over the hub's `/api/ui/press` and
looked for directions that lead nowhere. It is gone (code in the history at `8456e2e`) for two
reasons: it was the only tool that needed the television, which is locked, and from its sixth line on
it reported results that were not true — a measuring tool that lies silently is worse than none. What
it was meant to prove is covered without the device by `tools/test-picker.js` (up/down inside an open
answer list), `tools/test-home-keys.js` (the keys on the start page) and the rows walker above, which
also catches a direction that appears to work but leaves the row.

## Continuous integration

`.github/workflows/checks.yml` runs `tools/check-all.sh` on every push and every pull request, on
`ubuntu-24.04` with node 20 and a current Chrome.
