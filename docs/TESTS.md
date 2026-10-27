# Checks

Everything that can be checked without the TV runs with one command:

```bash
tools/check-all.sh
```

The script starts its own configuration server on port 8484 and a headless Chrome on port 9333, and
cleans both up at the end. `--keep` leaves them running so you can look for yourself.

## The layers

**1. Syntax.** `node --check` over every source file in `app/`, `web/` and `tools/`.

**2. node 8.** `tools/check-node8.py`. The TV runs node 8.12, so anything that only exists in later
versions (`new URL`, `mkdirSync({recursive})`, `readBigUInt64BE`, the newer `http.get()` signature)
is caught here instead of crashing on the device. 10 checks.

**3. Icons.** `tools/check-icons.py` checks that every icon key in the configuration has a file and
every file a key. 43 icons.

**4. Configuration server.** `tools/test-web-api.py` starts the server with a stub catalogue and a
temporary configuration, then checks every endpoint: `/api/health`, `/api/config` (GET, PUT, POST
with 403, 409 and 415), `/api/schema`, `/api/wall/<id>`, `/api/apps`, `/api/diag`, the Home
Assistant bridge including the rejected toggle, backup, `/api/tv/key` with a long press and the
weather line. 46 checks, five of them for the weather with a local Open-Meteo stand-in so the suite
never needs the network: off by default (and provably nothing fetched), rounded values with a word,
the fifteen-minute cache, the geocoding, an unknown place. Also: a backup that carries no secrets, a
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

## Continuous integration

`.github/workflows/checks.yml` runs `tools/check-all.sh` on every push and every pull request, on
`ubuntu-24.04` with node 20 and a current Chrome.
