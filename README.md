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

![CleanFrame Hub: appearance settings with the wallpaper library](docs/img/hub.jpg)

*The hub in the browser: every setting of the app, saved as you change it — plus a live
picture of the TV and a remote control for the cases where walking to the TV is too far.*

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

Three ways to the launcher, and one optional part after it. Only the hub needs SSH.

| Route | Command | Needs | Updates |
| --- | --- | --- | --- |
| By hand | Glasshouse → Apps → *install from a file* | the IPK | install the new IPK again |
| Launcher script | `./tools/install-launcher.sh --tv <ip>` | `curl`, `python3` | run it again |
| Homebrew Channel | the repository file from a release | — | the channel does it |
| The hub (optional) | `./tools/install-hub.sh --tv <ip>` | SSH as root | run it again |

The Homebrew Channel route is how the other webOS launchers are distributed and how this one will
be, once there is a public release. Until then: by hand, or the script.

### 1. From a computer: Linux and macOS

No SSH needed for the launcher — the script talks to Glasshouse on port 8080:

```sh
./tools/install-launcher.sh                 # find the TV, build the IPK, install it
./tools/install-launcher.sh --tv 192.168.1.50
./tools/install-launcher.sh --ipk cleanframe_all.ipk   # a release IPK
./tools/install-launcher.sh --dry-run       # find and print the plan only
./tools/install-launcher.sh --lang de       # German prompts

./tools/install-hub.sh --tv 192.168.1.50    # optional: the settings page, needs root
./tools/install.sh --tv 192.168.1.50        # both, if you like
```

Real output of a launcher run:

```text
$ ./tools/install-launcher.sh --tv 192.168.1.50
TV: 192.168.1.50
Glasshouse answers (192.168.1.50:8080)
Building the IPK from app/ ...
Installing com.blackpearl.cleanframe
   package cleanframe_all.ipk for com.blackpearl.cleanframe
   uploading 15802724 bytes
   confirming com.blackpearl.cleanframe 0.5.0
   installed: com.blackpearl.cleanframe 0.5.0 (16770618 bytes)
Installed: com.blackpearl.cleanframe 0.5.0
Started. The start page should be on the TV now.
Next: the settings (values on the start page, Home Assistant) need the hub:
./tools/install-hub.sh 192.168.1.50
```

And the hub, which does need SSH:

```text
$ ./tools/install-hub.sh --tv 192.168.1.50
TV: 192.168.1.50
SSH as root, uid=0
node 8.12.0 on the TV
Copying the hub to /var/lib/cleanframe ...
Setting up the autostart ...
Starting the service ...
Hub is running: http://192.168.1.50:8484/   (API: /api/health, /api/config, /api/apps)
```

### 2. From a computer: Windows (PowerShell)

`tools/install.ps1` runs the same stages; the flags differ only in spelling (`-Tv`, not `--tv`).
It needs the OpenSSH client (a Windows feature) and Python 3 on `PATH` for the network search.

```powershell
.\tools\install.ps1 -Tv 192.168.1.50
.\tools\install.ps1 -Tv 192.168.1.50 -LauncherOnly
.\tools\install.ps1 -Tv 192.168.1.50 -DryRun -Lang de
```

### 3. By hand, without the script

1. get the IPK: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`, or the file from a release
2. install it on the TV: Glasshouse, Apps, install from a file
3. open CleanFrame once from the app list, so it sets itself up
4. the hub is optional and needs a root shell: `./tools/install-hub.sh --tv <ip>`

### 4. Homebrew Channel repository

Not yet. That route needs a public release: the other launchers in the scene ship a repository
file, the Homebrew Channel reads it under *Settings*, *Add repository*, and updates come from
there.

The file itself is no work, `tools/make-apps-json.py` writes it from a built IPK (hash, size,
manifest, download URL):

```sh
python3 tools/build-ipk.py app dist/cleanframe_all.ipk
python3 tools/make-apps-json.py --ipk dist/cleanframe_all.ipk --tag v0.5.0
```

What is missing is the release it points at. Until then the IPK comes from a build, or from
whoever you got this from.

### What the scripts do, and why the address is optional

The launcher script searches the network when you do not pass an address: the ARP table first,
then a sweep of the local /24 for a host that answers Glasshouse's `/api/apps`. The hub script does
the same and then proves that SSH answers as root before it copies anything.

Both stop instead of guessing: no Glasshouse means no install, a non-root session means no hub.

`tools/install.sh` is the wrapper that runs both parts; it installs the hub only when the TV is
rooted, and never roots anything itself. `--dry-run` prints the plan, `--info` prints model, webOS,
node and root state, `--launcher-only` touches nothing but the IPK.

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
