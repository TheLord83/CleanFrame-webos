# Changelog

Newest first. The version in `app/appinfo.json` and in the IPK is the number the Homebrew
Channel shows; the tag matches it.

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
