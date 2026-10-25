# Checks

Everything that can be checked without the TV runs with one command:

```bash
tools/check-all.sh
```

The script starts its own configuration server (port 8484) and a headless Chrome
(port 9333), and cleans both up at the end. `--keep` leaves them running so you can
look for yourself.

## The four layers

**1. Syntax** — `node --check` over every source file in `app/`, `web/` and `tools/`.

**2. node 8** — `tools/check-node8.py`. The TV runs node **8.12**. Anything that only
exists in later versions (`new URL`, `mkdirSync({recursive})`, `readBigUInt64BE`, the
new `http.get()` signature) is caught here instead of crashing on the device.

**3. Icons** — `tools/check-icons.py` checks that every icon key in the configuration
has a file and vice versa.

**4. Configuration server** — `tools/test-web-api.py` starts the server with a stub
catalogue and a temporary configuration and checks every endpoint: `/api/health`,
`/api/config` (GET/PUT/POST with 403/409/415), `/api/schema`, `/api/wall/<id>`,
`/api/apps`, `/api/diag`, the Home Assistant bridge, backup, `/api/tv/key` with a long
press. Expectation: 33/33.

## Interface

**Keys** — `tools/test-ui-keys.js` loads the home screen in Chrome, replaces the device
layer with a stub and sends real key presses through `Input.dispatchKeyEvent`. Covers
navigation, context menu, rename, language, clock format, settings pages and geometry.
Expectation: 26/26.

**Live apply** — `tools/test-live-apply.js` is the answer to the failures of
2026-10-25: a tile name and icon stayed old because the rebuild key did not contain
them; the wallpaper was set as a value only, the image file stayed; the text size was
fixed in pixels. The test writes a fixed starting configuration, changes it over HTTP
and measures the **visible result** in the DOM:

- tile name in the list view
- icon change in the list view
- wallpaper: file name of the loaded image
- text size 150 % → 132 px
- senior mode at 100 % → 110 px, off → 88 px
- tile name in the bottom dock
- spinner in the web interface: runs, then stops

Expectation: 9/9.

## Two rules, both learned from failures

**Measure the visible result, not the state.** The revision counter was already
incremented while the screen still showed the old content — that is why the bug went
unnoticed. Every check waits for the DOM (up to 12 s).

**A check without output is not a passed check.** `check-all.sh` counts a check as
passed only when it exits 0 **and** prints a machine-readable line:

```
RESULT <passed>/<total>
```

Both numbers must match. A human summary alone is not enough: a run that printed
`0/9 passed` would have counted as green, and on 2026-10-25 the new test was missing the
call to its main function — the script exited 0 without a single check, and the run was
green and worthless. The guard is proven: `RESULT 8/9`, a missing `RESULT` line and
exit code 1 each turn the layer red.

## What is not checked here

- **The device.** Installation, start, the real screen, the long-press threshold, the
  context menu from the remote, the screensaver: that is `tools/install.sh` plus looking
  at the TV.
- **Glasshouse.** Replaced by a stub in the tests; the real app list only exists on the
  device.

## Continuous integration

`.github/workflows/checks.yml` runs `tools/check-all.sh` on every push and every pull
request on `ubuntu-24.04` with node 20 and a current Chrome.
