# CleanFrame for webOS

**Unofficial port of [CleanFrame](https://github.com/nthnclrk/CleanFrame) to LG TVs running
webOS 6 or newer.** Not affiliated with the original project and not maintained by its author.

CleanFrame was written for the Samsung The Frame (Tizen): one photo, a large clock, your own
apps — instead of a cluttered manufacturer start screen. This port keeps the original code —
layout, focus logic, settings, wallpapers, materials — and replaces only the device layer:
`app/device.js` talks to [Glasshouse](https://github.com/rorygallagher2024/glasshouse) on the
TV instead of the Tizen API.

![Web interface](docs/img/webschnittstelle.png)

*The hub: every setting, a live picture of the TV and a remote control on one page.*

## Two parts

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Launcher** | The start screen as a webOS app (`com.blackpearl.cleanframe`), packaged as an IPK | On the TV |
| **CleanFrame Hub** | Configuration server and web interface: edits settings, shows a live picture, sends remote key presses | Also on the TV, reachable from the LAN |

The hub owns the configuration. The launcher reads it at start and re-reads it every two
seconds, so a change made in the browser is visible on screen within seconds — no restart, no
reinstall.

## Features

- List layout and bottom dock, photo / light / dark background, 15 wallpapers with rotation
- Typography, focus and material styles, clock in 24 h or 12 h, German and English interface
- Senior mode: larger labels (at least 125 %) for the person actually watching
- Own app catalogue: installed webOS apps, HDMI inputs, and system apps Glasshouse does not list
- Rename tiles, choose icons, reorder or remove them — context menu on the remote included
- Web interface without a PIN: token optional, requests from the local machine always allowed
- Home Assistant values as tiles; MQTT and update blocking through Glasshouse
- Screensaver, setup wizard, backup and restore of the configuration

## Requirements

- LG TV with webOS 6 or newer, **rooted** (Homebrew Channel installed)
- Glasshouse on the TV, reachable at `127.0.0.1:8080`
- IPK installation through `luna://com.webos.appInstallService/dev/install` or the Glasshouse
  dashboard (Apps → Sideload)

## Install

```sh
./tools/install.sh <tv-ip>          # Linux and macOS
.\tools\install.ps1 -Tv <tv-ip>     # Windows PowerShell
```

One command puts both parts on the TV: it builds the IPK, uploads it through
Glasshouse's installer, sets up the hub with autostart, then proves the result — the
hub answers on port 8484, the app is in the catalogue, and the hub can take a picture
of the launcher. `--dry-run` (`-DryRun`) only detects, checks and prints the plan.

The hub then answers on `http://<tv-ip>:8484/`. On the TV the service is controlled
with `/var/lib/cleanframe/cleanframectl status`.

Rooting the TV cannot be automated — it needs the remote control. Step by step in
[docs/INSTALL.md](docs/INSTALL.md).

## Build and test

```sh
python3 tools/build-ipk.py app ipk/cleanframe_all.ipk   # IPK
tools/check-all.sh                                      # all checks, no TV required
tools/make-port-patch.sh                                # refresh docs/PORT-CHANGES.patch
```

`tools/check-all.sh` starts its own configuration server and a headless Chrome, then runs
syntax, node 8 compatibility, icon, API, remote-key and live-apply checks in one go. Details in
[docs/TESTS.md](docs/TESTS.md). The same script runs in CI on every push.

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md) — from a stock TV to a running start screen
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — symptom, cause, command
- [docs/WEB.md](docs/WEB.md) — hub: API endpoints, configuration schema, operating the service
- [docs/TESTS.md](docs/TESTS.md) — what is tested and how
- [docs/ICONS.md](docs/ICONS.md) — icon library and its sources
- [docs/PORT-CHANGES.patch](docs/PORT-CHANGES.patch) — full difference to upstream

## Differences to upstream

`app/device.js` is new; `app/main.js` has a contained delta (webOS app IDs, LG labels, remote
handling, test hooks); `app/style.css` has Chromium 79 compatibility fixes; `app/i18n.js` and
`app/appinfo.json` are new; `app/config.xml` (Tizen packaging) is gone. Everything under
`app/assets/` is byte-identical to the original.

## Tested on

- LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401 (`kisscurl-koli`), Chromium 79, rooted
- Glasshouse 0.118.0 as the device bridge
- Installed through the Glasshouse sideload path, app ID `com.blackpearl.cleanframe`

No promise for other models. Rooting and sideloading third-party packages can affect warranty
and DRM features; install at your own risk.

## Licence and credits

- Port code (webOS bridge, packaging, build scripts): MIT — see [LICENSE](LICENSE); both
  copyright lines are in there (original and port)
- Original CleanFrame: MIT, Nathan Clark
- Interface and assets come from CleanFrame: MIT for code, separate terms for fonts (OFL),
  icons (CC0/MIT) and photos (Unsplash Licence) — see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), photo sources in
  [docs/wallpaper-SOURCES.json](docs/wallpaper-SOURCES.json)
- Brands such as Netflix, YouTube or Disney+ belong to their owners. This project claims no
  affiliation and no endorsement.

Deutsche Fassung: [README.de.md](README.de.md)
