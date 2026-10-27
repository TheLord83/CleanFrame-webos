# CleanFrame for webOS

**Unofficial port of [CleanFrame](https://github.com/nthnclrk/CleanFrame) to LG TVs running
webOS 6 or newer.** Not affiliated with the original project and not maintained by its author.

CleanFrame was written for the Samsung The Frame (Tizen): one photo, a large clock, your own
apps — instead of a cluttered manufacturer start screen. This port keeps the original code —
layout, focus logic, settings, wallpapers, materials — and replaces only the device layer:
`app/device.js` talks to [Glasshouse](https://github.com/rorygallagher2024/glasshouse) on the
TV instead of the Tizen API.

![CleanFrame on a 43" LG TV: one photo, the clock, six tiles](docs/img/launcher.jpg)

*The start screen: one photo, the clock, the apps you actually use. Rendered at 1920×1080,
no chrome from the TV around it.*

![CleanFrame Hub: the home screen tab, tiles with order, name and icon, and the live picture of the TV beside it](docs/img/hub-home.jpg)

*The hub in the browser: every setting of the app, saved as you change it — plus a live
picture of the TV and a remote control for the cases where walking to the TV is too far.*

**[Download the latest release](https://github.com/TheLord83/CleanFrame-webos/releases/latest)** —
it is one IPK, Glasshouse installs it, five minutes. The settings page next to it is optional.

## Two parts

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Launcher** | The start screen as a webOS app (`com.blackpearl.cleanframe`), packaged as an IPK | On the TV |
| **CleanFrame Hub** | Configuration server and web interface: edits settings, shows a live picture, sends remote key presses | Also on the TV, reachable from the LAN |

The hub owns the configuration. The launcher reads it at start and re-reads it every two
seconds, so a change made in the browser is visible on screen within seconds — no restart, no
reinstall.

## Why root?

Two separate answers, and that is the reason the install is in two parts:

- **the launcher** is a normal webOS app. It needs root once, because installing any package on a
  stock TV goes through the app installer, which is only reachable with a root shell. Afterwards the
  app itself runs without root.
- **the hub** stays root-only: it lives in `/var/lib/cleanframe`, starts itself at boot and reads
  the TV's internals for the live picture. There is no way around that.

So root is a prerequisite, not a feature of this project. How to get it belongs to the
[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel): their guide covers each
generation and they keep up with firmware updates. The path that was used on the test TV here —
SlopBro plus a firmware check — is documented in [docs/ROOTING.md](docs/ROOTING.md) and is
explicitly unsupported.

## Features

- List layout and bottom dock, photo / light / dark background, 15 wallpapers with rotation
- Typography, focus and material styles, clock in 24 h or 12 h, German and English interface
- Senior mode: larger labels (at least 125 %) for the person actually watching
- Own app catalogue: installed webOS apps, HDMI inputs, and system apps Glasshouse does not list
- Rename tiles, choose icons, reorder or remove them — context menu on the remote included
- Web interface without a PIN: token optional, requests from the local machine always allowed
- Home Assistant values as a status strip on the start page (your labels, states translated, no restart needed); MQTT and update blocking through Glasshouse
- Screensaver, setup wizard, backup and restore of the configuration

Where the firmware number is on the TV — with the two ways to find it: [docs/FIRMWARE.md](docs/FIRMWARE.md).

## What you need

- an LG TV running webOS, **rooted**. In practice that means the
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel); how to root a TV is
  its guide's job, not this README's
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installed and opened once, its
  dashboard answering on port 8080. It accepts the IPK and the launcher reads its app list from it;
  without Glasshouse you get an empty dock
- a way to get an IPK onto the TV: the install script below, or by hand through Glasshouse
  (Apps, install from a file) or webOS Dev Manager

### Which TVs

| | TVs | What to expect |
| --- | --- | --- |
| **Tested** | LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401, Chromium 79, Glasshouse 0.118.0 | Everything in this README |
| **Very likely** | other webOS 6 sets (2021, "webOS 6.0") | Same browser engine, not tried |
| **Untested** | webOS 7, 9, 10, 11 ("webOS 23" to "webOS 26"), OLED C and G series | No idea. That is what testers are for |
| **Not supported** | a TV without root, without the Homebrew Channel or without Glasshouse | The launcher is an app, but the hub needs a root shell |

## Install

One way that works today, one that comes with the release, and the scripts — which are
experimental and not the place to start.

| Route | How | Needs | Status |
| --- | --- | --- | --- |
| **By hand** | Glasshouse → Apps → *install from a file* | the IPK | works, five minutes |
| Homebrew Channel | a repository file from a release | — | not yet, needs the public release |
| Scripts | `tools/install-launcher.sh`, `tools/install-hub.sh` | `curl`, `python3`, SSH | **experimental** |

The launcher is one IPK and Glasshouse installs it. That is the whole installation. The hub is
optional and needs SSH, it is a copy plus an autostart.

### 1. By hand, five minutes

1. get the IPK from the [latest release](https://github.com/TheLord83/CleanFrame-webos/releases/latest),
   or build one: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`
2. Glasshouse → **Apps** → *install from a file* → pick the IPK → confirm the version prompt
3. start CleanFrame once from the app list; it writes its configuration on first start
4. done. The start page runs, no hub needed

The hub is for the people who want the settings page in the browser (that is where the Home
Assistant values, MQTT and the remote live). It is a node process and needs a root shell:

```sh
scp -r web root@<tv-ip>:/var/lib/cleanframe
ssh root@<tv-ip> 'chmod +x /var/lib/cleanframe/cleanframectl && /var/lib/cleanframe/cleanframectl restart'
```

Then open `http://<tv-ip>:8484/`. Details, including the autostart hook: [docs/INSTALL.md](docs/INSTALL.md).

### 2. Homebrew Channel repository

The normal way, and the way the other launchers in the scene are distributed: the Homebrew
Channel reads a repository file under *Settings*, *Add repository*, and updates arrive from then
on. Add this address:

```text
https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
```

It points at the newest release, so the address keeps working without a new one every time. The
same file is in the repository as [`repo/apps.json`](repo/apps.json)
(`raw.githubusercontent.com/TheLord83/CleanFrame-webos/main/repo/apps.json`) if you want to pin
what you install. Both are generated by `tools/make-apps-json.py` from the built IPK — hash,
size, manifest, download URL — and attached to the release.

### 3. The scripts — experimental, and hidden here for a reason

There are three: `install-launcher.sh` (IPK through Glasshouse, no SSH), `install-hub.sh` (the
hub over SSH) and `install.sh` (both, never roots anything). They are written, they run, and
they have been used on exactly **one** TV — the 43NANO779PA in this README. No second model, no
second webOS version, no Windows machine, no macOS.

So: use the way above unless you want to debug them. They find the TV on the network, build the
IPK, upload it and verify the result, which is convenient — but every one of those steps is a
guess in your network, not in mine.

```sh
./tools/install-launcher.sh --tv <tv-ip>     # the app, no SSH
./tools/install-hub.sh --tv <tv-ip>          # the settings page, SSH as root
./tools/install.sh --tv <tv-ip>              # both
./tools/install.sh --info                    # model, webOS, node, root state
```

They stop instead of guessing: no Glasshouse means no install, a non-root session means no hub.
`--dry-run` prints the plan, `--lang de` answers in German, `--help` lists the rest.

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

## Warranty and risk

Rooting and sideloading third-party packages can affect warranty and DRM features; install at
your own risk. The app ID is `com.blackpearl.cleanframe` and it installs through Glasshouse's
sideload path like any other homebrew app. What is tested and what is not: see
[Which TVs](#which-tvs).

## Problems and questions

Open an [issue](https://github.com/TheLord83/CleanFrame-webos/issues) for anything that is not a
security problem, or write to **193955790+TheLord83@users.noreply.github.com**. A report is worth ten times more with the
model, the webOS version and a photo of the screen.

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
