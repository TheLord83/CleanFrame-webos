# Changelog

Newest first. The version in `app/appinfo.json` and in the IPK is the number the Homebrew
Channel shows; the tag matches it.

## 0.6.9 (the logos were off by the height of themselves)

The marks were positioned with a double offset, and the measurement that was supposed to
prove otherwise measured a distorted render. Both are fixed:

- **`markBaseline()` already returns the top of the drawing** (label line minus the drawn
  height). The new sizing code subtracted the height a second time, so every mark sat
  exactly one logo-height too high — 108 px at the dock — and was cut off by the strip.
  That is why Netflix read as 57 × 52 instead of 59 × 108: not small, but clipped. Only
  the viewBox origin is subtracted now.
- **The mask element is the whole viewBox again, not the ink box.** `mask-size: 100% 100%`
  maps the entire SVG onto the element, so sizing the element to the ink squeezed the
  viewBox into it while the offset was applied a second time — worst for Netflix, whose
  viewBox is 24 × 24 but whose ink is only 13.2 × 24 wide.
- **Metrics are in user units now.** `tools/measure-icons.py` rendered every SVG into a
  240 square; Prime Video's `viewBox="5.6 12.6 13 3.4"` was squashed to a third, so its
  numbers were meaningless. It renders at the viewBox aspect and records `vx/vy/vw/vh`
  plus ink bounds in user units.
- **Size by area, not by the longest side.** Equal area (geometric mean) makes a portrait
  mark and a wide wordmark read as equally large; the old longest-side rule made Netflix
  thin and Prime Video a 232 px line. The mild ink weighting stays (0.90–1.12), and the
  caps are 190 × 92 so nothing hits the field edge — at 226 × 104 Netflix pinned the
  height cap and looked the biggest, Prime the width cap and looked like a rule.
- **Measured on the rendered picture, not in my head**: `tools/measure-render.py` reads
  the screenshot, clusters the white pixels into six columns, splits mark from label by
  the largest gap, and prints bottoms, centres and areas. Result: bottoms 814–815 (1 px
  spread), gap to the name 10–11 px, centres within 1.5 px, areas 4 600–11 088.
- `tools/shots-home.js` gained `PLAIN=1`: photographs the home screen on a flat
  background. Without it the measurement read the wallpaper (57 px "Netflix" was a cloud).

## 0.6.8 (the list view had no way to the utilities)

- **In the list view the utilities were unreachable from the rows.** They sit as a
  vertical column at the bottom right, below the last row, but `listHomeKey` only knew
  `right` as a way out of the rows — and nobody presses right when everything is
  stacked vertically. Down from the last row now enters the column (top entry), up from
  its top entry returns to the rows, and left/back still leaves it. Measured first with
  `probe-list.js`: utilities at x 1465, y 673, six rows from y 191 to 746.
- **New test** `test-list-utils.js` (6 checks: walking the rows, entering the column,
  returning, and both old directions), wired into `check-all.sh`.

## 0.6.7 (keys follow the layout, and the clock has an off switch)

- **Every key now moves in the direction the elements actually stand.** The weather and
  typography pages were a two-column grid (`grid-auto-flow: column`) while the keys
  walked the entries linearly, so "down" jumped diagonally and "right" was the only way
  to reach a value that sat beside its label. Both pages are one column now: down walks
  the questions, left/right picks the value inside a question.
- **The settings overview no longer traps the cursor.** Down used to stop at the end of
  the first column, and right jumped from there into the same row of the second column —
  which reads like a jump because the entries are visually stacked. Down now walks all
  twelve entries, left/right still switches column.
- **The clock is switched where it lives.** "Clock on/off" was its own row two entries
  above "Clock and language"; the row carries 24 h / 12 h / Off instead, and the separate
  switch is gone. Turning it off then on again works reliably now: the old code *toggled*
  a value that could be `undefined`, so a second press switched it off again — the reason
  the clock could not be brought back.
- **A reading's focus no longer moves the strip.** The dashed frame on a non-switchable
  chip was a `border`, which made that chip 4 px wider and taller and pushed its
  neighbours around while walking the strip. It is an `outline` now — no layout change —
  and it is the only frame there, instead of a second frame drawn over the glow ring.
- **The three utilities are further apart** (20 px → 44 px): with text labels beside the
  icons they read as one long word.
- **Removing an app from the home screen is an X, not a sentence.** Every row carried the
  same "Remove from Home" label, which made six rows restless; the X says the same and
  keeps the row quiet. The last remaining tile still shows the hint in words.
- **Logos are sized by their longest side, and weighted by stroke thickness.** Measuring
  showed the old rule produced a 30 px wide Netflix (its mark is portrait, 132 × 240 in
  the field) next to a 232 px wide Prime Video (230 × 53). Scaling by `sqrt(w*h)` had made
  wide marks grow into their field and tall ones shrink. `ink` — drawn pixels over the
  mark's own box — replaces the old `fill`, which was measured against the 240 square and
  produced values above 1. `tools/measure-icons.py` measures both from the rendered SVG,
  so a differently shaped `viewBox` can no longer shift a mark.
- **New tools**: `probe-clock.js` (is the clock drawn, where), `shots-home.js` (photos the
  home screen in the tile / strip / utilities state), `measure-icons.py` (the metrics).

## 0.6.6 (the whole strip, and a way to the settings)

- **Every chip in the value strip can be focused now.** Before, only the switchable
  ones were reachable, so with a strip of window / temperature / lamp there was exactly
  one stop and left/right did nothing. Readings are now focusable and highlighted with a
  dashed frame; OK on them switches nothing and says nothing. Entering the strip still
  follows the tile you came from (right edge → rightmost chip, middle → the chip above
  the tile), and back returns to the tile underneath.
- **Down out of the strip goes to the utilities, not back to the tiles.** The tiles were
  reachable from the strip but the utilities — and with them the settings — were not,
  which is why the way into the settings seemed to be missing entirely. Back still
  returns to the tile under the chip.
- **The utilities row is visible.** It sat at 66 % opacity over a photo and was
  effectively invisible in the room. It now rests at 82 % and comes fully forward
  (`is-awake`) when the focus reaches it, with a soft backing so it reads on any
  wallpaper.
- **New test `tools/test-ha-walk.js`**: enters the strip from the right edge, walks to
  the left end, checks that every chip is reachable and distinct, that OK on a reading
  changes nothing, and that down leaves for the utilities while back returns to the
  tiles. `tools/test-settings-reachable.js` additionally checks that the same down path
  works from inside the strip.
- **`tools/probe-ha.js`**: prints chip count, focused chip and zone after each key — the
  tool that showed the first walk test was starting on the leftmost tile, so "left"
  correctly did nothing and the test, not the code, was wrong.
- **Logos sit on one line now, optically.** Two separate faults, both measured:
  (1) the logo mask was a square and the SVG was stretched into it, so Disney+ was drawn
  149 px high inside a 124 px field; the mask now takes the drawing's own aspect ratio.
  (2) `markHtml` scaled against `sqrt(w*h)` instead of the drawn height, which let wide
  marks grow past their field. Marks are now aligned by their *bottom edge* to the name
  line (`markBaseline`), not by the centre of an invisible field: Netflix is 75 px high
  and YouTube 47, and with a shared centre their bottom edges were 25 px apart — which is
  exactly what the eye reads as "not centred". All six marks now end on the same line,
  spread 0 px.
- **`Prime Video` sat 60 px too high.** Its SVG has a `viewBox` of `5.6 12.6 13 3.4`,
  not the 24×24 every other icon uses, and `metrics.js` assumed 24×24. The metrics are
  now measured from the rendered SVG rather than hand-maintained, so a differently
  shaped `viewBox` can no longer produce a wrong offset.
- **New tests**: `tools/test-mark-alignment.js` (every logo's bottom edge against its
  name, gaps within 3 px, nothing leaving its field) and `tools/probe-mark.js` (prints
  each mark's style, box and gap — this is what exposed the square-mask fault).
- **Settings navigation is documented by test, not assumed.** The overview is two columns
  of six: down runs the first column and stops, right keeps the row in the second column
  (from "Uhr" to "LG"), and from there the entry is *up*. `tools/test-ha-strip.js` now
  walks that path and finds "Werte auf der Startseite" with the keyboard instead of
  clicking it.

## 0.6.5 (the strip, and the logo above its name)

- **The way up and the way down were swapped.** The value strip is drawn above the dock
  (`renderHaStrip`: `top = dockTop - h - 24`, measured: strip bottom 636, dock top 676),
  the utilities row sits below it. 0.6.4 had it the other way round, so up went into the
  utilities and the strip was reachable in the wrong direction. Now: up enters the strip,
  down reaches the utilities, and up leaves the utilities again — the way you came
  (with back still working).
- **The strip could not be walked.** Coming into it with "out", `f.h` kept whatever the
  last tile left behind while the drawn focus sat on the last chip; left/right then moved
  a number nobody could see. The strip now uses left/right directly, and the entry point
  follows the tile you came from: right edge → rightmost chip, left edge → leftmost chip,
  middle → the chip above the tile. Leaving the strip with down puts the cursor back on
  the tile under that chip instead of the first one.
- **The logo was 16 px off centre.** The tile is 288 wide and the mark 232, but the rule
  `.a-both .tile .mark` used `left:44px` — `(288-232)/2 = 28`. The name underneath was
  centred, the logo above it was not, which is exactly what looked wrong in the room.
  Measured after the fix: mark centre 812, tile centre 812, offset 0.
- **New test `tools/test-settings-reachable.js`**: from the tiles, down to the utilities,
  right to "Einstellungen", OK opens the overview, back returns — the path that was
  blocked in the room.
- **`tools/measure-home.js`**: prints tile/mark/label centres, the position of the strip
  and its chips, and walks the strip with the arrow keys. Numbers, not screenshots, so
  a report like "the icon is not centred" can be answered with a measurement.
- `tools/test-home-keys.js` no longer pins the pre-0.6.4 tile size (200 high, label at
  128) or the swapped axis; it checks 216/140 and up-into-strip, down-to-utilities.

## 0.6.4 (navigation, panels, room for the icons)

- **Down and up point where things actually are.** The strip of Home Assistant values
  sits *above* the dock and the utilities row (screensaver, all apps, settings) *below*
  it, but the keys were swapped: pressing down went up into the strip and pressing up
  went down into the utilities. Now down reaches the utilities and up reaches the strip.
  `tools/test-ha-strip.js` and `tools/test-home-keys.js` were wrong in the same way and
  were corrected with it.
- **The clock no longer disappears.** `lookOf()` did not carry the clock field, and
  `serverPayload()` turned the missing field into `clock: false` — so every write
  (switching 12/24 was enough) switched the clock off in the stored configuration, and
  there was no way to switch it back on from the television. The field travels now, the
  absent field means "on", and there is a **Clock** row in the settings to turn it on
  and off at the TV.
- **A tick box is a row, not a column.** Clock and language were one row with two
  columns, so "down" jumped over "12 h" and landed on the language. Typography and
  weather had the same shape. Every question is now its own row: down walks the entries,
  left/right picks the value inside a row.
- **The weather panel stays on the screen.** Four questions with four answers each were
  taller than the television; they now sit in two columns (how it looks on the left,
  where it sits on the right), and the panel ends at 928 of 1080 instead of running off
  the bottom.
- **Settings: two columns of six, at the normal size.** Twelve entries in one column
  only fit by shrinking the type; a thirteenth would not have fit at all. Left/right
  switches columns, down walks one column, and the last row now ends at 932 instead of
  1034 (the footer hint starts at 968).
- **Bigger marks.** The dock tile grew to 288x216 with the label at 140, the mark from
  200x118 to 232x124; icons-only from 152x116 to 178x130 in a 200x150 tile; the all-apps
  grid from 120x72 to 176x84. Measured, not estimated: no mark leaves its tile and none
  touches its label.
- **New tests**: `tools/test-home-keys.js` (cursor movement and tile geometry on the
  start page) and `tools/test-detail-panels.js` (the three settings panels: item order
  under the arrow keys, panel geometry, and that the clock survives every weather
  position).

## 0.6.3 (installer wizard)

- **`tools/install-wizard.py`**: one run from an untouched television to a configured
  start page. Find the TV, check that it answers and what it is, check root, install or
  update Glasshouse, offer the ad block, install CleanFrame and the hub, and end with the
  one address to open in a browser. Every step says what it is about to change first;
  everything it ran lands in `~/.cleanframe-install.log`.
- **Glasshouse is handled as somebody else's software** (`tools/lib/glasshouse.py`):
  the release IPK comes from its GitHub release, is checked against the sha256 in its
  manifest, and is only then handed to the TV. Drafts and pre-releases are never
  offered. Glasshouse is not in the Homebrew Channel catalogue yet, which is why the
  wizard fetches the release itself.
- **Rooting is delegated, not reimplemented** (`tools/lib/rooting.py`): the wizard reads
  the webOS version, names the published exploit that covers it (SlopBro, DejaVuln,
  faultmanager, RootMyTV — all third-party, AGPL-3.0 or MIT), shows licence, project
  link and risk, and needs `ERISK` typed before anything runs. No exploit code lives in
  this repository; the project's own files are fetched from its own URL.
- `tools/test-install-wizard.py`: 13 checks without a TV — hash verification, refused
  wrong hash, refused unknown config keys, the exploit pick per webOS version, a test
  that rooting cannot run unconfirmed, and one that greps the repository for exploit
  material (there is none).

## 0.6.2 (app list without Glasshouse)

- **The catalog no longer depends on Glasshouse.** The launcher asks webOS for the installed apps and
  reports them to the hub (`POST /api/apps/report`), which keeps them in `apps.json` next to the
  configuration. `/api/apps` prefers that list, falls back to Glasshouse, then to the built-in apps.
  Glasshouse stays the easiest way to install a package, it is just no longer a prerequisite for the
  settings page to show any apps.
- **App icons now load in the browser.** The catalog used to hand out `http://127.0.0.1:8080/...`
  URLs, which on a phone or laptop point at the phone or laptop. Icons go through
  `GET /api/apps/icon?id=` now, are fetched from the television once and cached in memory for the
  rest of the session.

## 0.6.1 (heartbeat)

- **The hub now says how alive it is (#9).** Every 30 seconds it writes a timestamp next to the
  configuration, and `GET /api/heartbeat` reports the age, the process, the start time and whether
  the last write is too old. Three intervals of slack, so one missed tick is a busy machine and not
  a hang. A clean stop writes `state: "stopped"` instead of just falling silent, which is the
  difference between a restart and a failure.
- Settings page, System tab: a heartbeat table with state, age, start time, process and file,
  refreshed every ten seconds while the tab is open.
- `tools/watch-hub.py` is the outside half: run it from cron on a machine that is always on, and a
  hub that hangs or disappears turns into an ntfy message. It only speaks when the state changes,
  so an empty cron mail means everything is fine.

## 0.6.0 (own wallpaper)

0.5.9 was built and never shipped, so this version carries both: the Back list, the start image
taken from the chosen wallpaper, an icon per tile, and the picture you upload yourself.

- **Your own picture as wallpaper (#2).** Settings → Appearance → Background has a file button.
  The browser crops the file to 1920x1080 (fills the screen, cuts the overhang in the middle),
  the hub stores it next to the configuration and serves it, and the television fetches it from
  the hub at 127.0.0.1:8484. Nothing leaves the house, and the launcher still talks to no other
  address. Uploaded pictures can be removed again; removing the one in use falls back to the
  first packaged wallpaper instead of leaving a setting that points at nothing.
- The hub refuses anything that is not exactly 1920x1080, is not JPEG or PNG, or is larger than
  6 MB. The size check reads the file header, not the numbers a browser claims.
- Own pictures have no pre-rendered material variants, so the frosted surface uses the picture
  itself. The packaged wallpapers keep their baked variants.
- Checks: three more API checks for upload, refusal and the foreign-origin case; the API suite is
  at 50.

## 0.5.9

Back is no longer a question, the start image is the wallpaper you picked, and a tile can carry
another icon.

- **Back shows the last five apps** (#1). It used to ask "Leave Home?"; now it opens the apps you
  started last, with LG's own home as the last line and Back closing the list. The list is kept on
  the television, so it works without the hub.
- **The start image is the wallpaper** (#4). `app/splash.png` is generated from the default wallpaper
  (`tools/make-splash.py`, a blurred 1920x1080 still) instead of the near-black square, and the page
  paints the wallpaper you actually chose over it, from localStorage, before the configuration
  arrives. The layer goes away once the real photo is decoded, so there is no white frame between
  splash and start page.
- **Another icon for a tile** (#11). Hold OK on a tile -> Icon: the catalog of 43 icons in four
  groups, plus "Own icon" and "Letters" for apps whose icon is ugly. Stored as `home[].icon` in the
  server configuration, the same field the hub writes, so both sides agree; the hub picker gained
  the same two choices.
- The icon catalog reaches the launcher as `assets/icons-catalog.js`, generated from
  `assets/icons.json` by `tools/make-icon-catalog.py` (a local `fetch` of JSON is not reliable from
  the package, a script tag is).
- Checks: the key test also covers the Back list, the icon panel and the start image layer; the
  device binding is no longer stubbed globally, so those tests talk to the real configuration server.
- **The icon panel speaks the interface language.** Two faults in one place: the English group names in
  the catalog were the German ones ("Spielekonsolen" on both sides), and the language lookup read a
  function as a value and always answered "English", so a German interface showed "Gaming consoles".
  Both fixed, and `tools/check-icons.py` now refuses a group whose English label equals the German one.
- Wallpaper status texts (loading, applying, preview, failure) were hardcoded English in a German
  interface; they go through the translations now. Icon names may wrap to two lines instead of
  losing their end ("Eigenes Symbol").

## 0.5.8

The television can now set what the browser could set, and senior mode stays where it belongs.

- **Text size on the television.** Settings -> Typography has the factor the browser already had:
  20 to 200 percent, applied while you watch. With senior mode on the factor never drops below
  125 percent, and the page says so instead of silently ignoring a smaller choice.
- **Weather on the television.** Settings -> Weather: what is shown (symbol and temperature, symbol
  alone, symbol with the word, text only), where it sits (before the clock, next to it, under it, at
  the right edge), the size, and the distance from the clock in four steps. Before this the
  television only had the switch and everything else lived in the browser.
- **Senior mode no longer inflates the settings.** It used to blow up labels that were already sized
  for the panel, so the values collided; the large text belongs to the start page, and the settings
  keep their own proportions.
- The settings list measures itself: eleven groups switch to the tighter pitch instead of letting the
  last row slide under the footer hint.
- German texts for the new rows, and the clock section finally has one too.

## 0.5.6

The weather line stops being a sentence and becomes a mark.

- **Icons.** One thin-stroked symbol per weather group (clear, partly cloudy, overcast, fog, rain,
  snow, thunder), drawn in the same colour as the text, no fills. Settings choose what is shown:
  symbol and temperature (the default), symbol alone, symbol with temperature and word, or text only.
- **Size and restraint.** Small, normal or large, and a quiet mode that draws it at 72 percent
  instead of the clock's 86.
- **Position.** Next to the clock, before it, under it, or at the right edge of the caption area.
- **Celsius only.** The unit switch is gone; the hub always asks Open-Meteo for Celsius and a stored
  `unit` is dropped instead of carried along.
- The installer no longer mistakes a busy television for one without Glasshouse: the probe asks
  twice with four seconds each before it gives up.

## 0.5.5

The first of the ideas from the neighbours, and a roadmap to go with it.

- **Weather line.** A temperature and a word next to the clock, switched on in the settings page
  under *Integrations*. Open-Meteo, no account, no key, no geolocation: the place is looked up once
  by name and stored as coordinates. The **hub** fetches it and caches it for fifteen minutes, so
  the television never talks to the internet. Off by default; without a hub the line stays empty.
- `GET /api/weather` and `POST /api/weather/place` in the hub API, `docs/WEB.md` describes both.
- Five new checks in `tools/test-web-api.py`, with a local Open-Meteo stand-in so the suite never
  needs the network: off by default, rounded values, the cache, the geocoding, an unknown place.
- `docs/ROADMAP.md` and twelve issues in the tracker, so the list of what is missing is written
  down instead of remembered.

## 0.5.4

The package lost two thirds of its weight, and nothing looks different.

- Wallpapers, thumbnails and panels are JPEG quality 86, progressive: 10,4 MB to 6,4 MB.
- The 60 material variants behind the adaptive appearance (blur, frost, tint, soft) were all
  blurred beyond recognition already. They are now 800x450 instead of 1920x1080, which the
  television upscales: 4,5 MB to 1,0 MB, minimum 38,8 dB PSNR against the original.
- The package drops from 15,9 MB to 7,8 MB. `tools/shrink-images.py` repeats the step in case
  new wallpapers arrive.

## 0.5.3

The settings page comes with the app.

- The IPK carries the hub under `hub/`. `app/hubboot.js` starts it through the Homebrew Channel's
  service when CleanFrame starts, waits for `/api/health`, and stops it when the app goes away. A
  Channel install now has a working settings page on port 8484 without SSH and without anything
  permanent on the TV. Build it with `--hub web`; without that flag the package has no hub and the
  app falls back to its localStorage configuration.
- A hub installed for good (`tools/install-hub.sh`) still wins: the bundled one sees port 8484 taken
  and stays quiet, and its stop command only matches its own path.
- Both modes share `/var/lib/cleanframe/config.json`; the bundled one logs to
  `/var/lib/cleanframe/hub-bundled.log`.
- `tools/check-all.sh` gained a stage for this: `tools/test-hubboot.js` (the three decisions, stubbed
  browser) and `tools/check-ipk-hub.py` (builds a package, looks inside).

## 0.5.2

Security, and the paperwork around it.

- `GET /api/backup` returns the configuration redacted. It used to hand out the Home Assistant
  token and the MQTT password in clear text to anyone who could reach port 8484.
- `POST /api/ha/check` no longer sends the stored Home Assistant token to an address from the
  request body. A check against another URL needs its own token; the stored one only ever goes to
  the stored URL.
- TLS certificates are verified in the Home Assistant client and in the connection check. A
  self-signed certificate needs `CF_HA_TLS_INSECURE=1` for the whole process, as a deliberate
  exception.
- A redirect during the connection check is followed only within the same host, so the
  `Authorization` header cannot travel to a third party.
- `/api/tv/info` reports model, webOS, firmware, board and memory. The serial number, the hardware
  ID and the two file paths it lives in are gone from the reply, and the serial row is gone from the
  System page of the hub.
- `/api/health` and `/api/diag` name the configuration file, not its directory.
- The IPK no longer carries development leftovers: the icon preview page (which contained
  `file:///root/...` paths), `.pyc` files and editor scratch files are excluded by the build.
- The subprocess calls for screen capture and the DevTools forward no longer take the hub down when
  the helper binary is missing. On anything that is not the TV that was a crash per live picture.
- `POST /api/ha/toggle` reads the entity state back after switching, once two reads agree. Light
  groups answer the service call with an empty list, so the chip used to keep the old value until
  the next 60 s poll.
- Contact: no mailbox in the repository any more. Issues for everything, private vulnerability
  reporting for security problems. The IPK maintainer field carries a GitHub noreply address.
- `LICENSE` holds the MIT text only, so GitHub recognises the licence; the third-party terms moved
  to `THIRD_PARTY_NOTICES.md`.
- `tools/build-public.sh` builds from this repository again (it expected two directories that do
  not exist), `tools/dev/wake-tv.py` requires a MAC instead of shipping the test TV's one, and the
  `npm run export:public` reference is gone.
- Documentation: `CONTRIBUTING.md`, this changelog, issue and pull-request templates, a CI badge.
  `docs/TESTS.md` names the real check counts.

## 0.5.1

- `repo.json` as a release asset, so `releases/latest/download/repo.json` is the stable address the
  Homebrew Channel reads.
- The install guide leads with the Homebrew Channel, then the manual route, then the experimental
  scripts.

## 0.5.0

- First public release: IPK, `repo.json`, Homebrew Channel repository, `docs/asset-sources.md` with
  every photograph and its licence, link checker in CI.

## 0.4.x

- Home Assistant values as a status strip, switchable chips, the values page on the TV, senior
  mode, the configuration hub with live preview and remote, screensaver, backup and restore.
