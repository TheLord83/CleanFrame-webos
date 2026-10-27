# Changelog

Newest first. The version in `app/appinfo.json` and in the IPK is the number the Homebrew
Channel shows; the tag matches it.

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
