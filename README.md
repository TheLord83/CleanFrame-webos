# CleanFrame for webOS

[![Checks](https://github.com/TheLord83/CleanFrame-webos/actions/workflows/checks.yml/badge.svg)](https://github.com/TheLord83/CleanFrame-webos/actions/workflows/checks.yml)

Unofficial port of [CleanFrame](https://github.com/nthnclrk/CleanFrame) to LG TVs running webOS 6
or newer. Not affiliated with the original project and not maintained by its author.

CleanFrame was written for the Samsung The Frame (Tizen): one photo, a large clock, your own apps.
The idea was a start screen without the clutter a manufacturer ships. This port keeps the original
layout, focus logic, settings, wallpapers and materials, and replaces only the device layer.
`app/device.js` talks to [Glasshouse](https://github.com/rorygallagher2024/glasshouse) on the TV
instead of the Tizen API.

![CleanFrame on a 43" LG TV: one photo, the clock, six tiles](docs/img/launcher.jpg)

*The start screen: one photo, the clock, the apps you actually use. Rendered at 1920×1080, without
the TV's own chrome around it.*

![CleanFrame Hub: the home screen tab, tiles with order, name and icon, and the live picture of the TV beside it](docs/img/hub-home.jpg)

*The hub in the browser: every setting of the app, saved as you change it, plus a live picture of
the TV and a remote for the cases where walking over to the TV is too far.*

[Add it to the Homebrew Channel](https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json):
one address, then install and update from the channel. Or take the
[IPK from the release](https://github.com/TheLord83/CleanFrame-webos/releases/latest) and hand it to
Glasshouse. The settings page next to it is optional.

## Two parts

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Launcher** | The start screen as a webOS app (`com.blackpearl.cleanframe`), packaged as an IPK | On the TV |
| **CleanFrame Hub** | Configuration server and web interface: edits settings, shows a live picture, sends remote key presses | Also on the TV, reachable from the LAN |

The hub owns the configuration. The launcher reads it at start and every two seconds afterwards, so
a change made in the browser is on screen within seconds, without restarting or reinstalling
anything.

## Why root?

The install has two parts because the two parts need different things.

The launcher is a normal webOS app. It needs root once, because installing any package on a stock TV
goes through the app installer and that is only reachable with a root shell. Afterwards the app runs
without root. The hub stays root-only: it lives in `/var/lib/cleanframe`, starts itself at boot and
reads the TV's internals for the live picture.

Root is therefore a prerequisite, not a feature of this project. Getting it belongs to the
[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel): their guide covers each
generation and they keep up with firmware updates. The path used on the test TV here, SlopBro plus a
firmware check, is documented in [docs/ROOTING.md](docs/ROOTING.md) and is explicitly unsupported.

## Features

- List layout and bottom dock, photo, light or dark background, 15 wallpapers with rotation
- Typography, focus and material styles, clock in 24 h or 12 h, German and English interface
- Senior mode: larger labels (at least 125 %) for the person actually watching
- Own app catalogue: installed webOS apps, HDMI inputs, and system apps Glasshouse does not list
- Rename tiles, choose icons, reorder or remove them, with a context menu on the remote
- Web interface without a PIN: token optional, requests from the local machine always allowed
- Home Assistant values as a status strip on the start page (your labels, states translated, no
  restart needed); MQTT and update blocking through Glasshouse
- Weather next to the clock: a thin symbol and the temperature, position and size up to you, fetched
  by the hub from Open-Meteo so the television stays offline
- Screensaver, setup wizard, backup and restore of the configuration

Where the firmware number is on the TV, and the two ways to find it:
[docs/FIRMWARE.md](docs/FIRMWARE.md).

## What you need

- an LG TV running webOS, rooted. In practice that means the
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel); how to root a TV is its
  guide's job, not this README's
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installed and opened once, its
  dashboard answering on port 8080. It accepts the IPK, and the launcher reads its app list from it.
  Without Glasshouse the dock stays empty
- a way to get an IPK onto the TV: the Homebrew Channel, Glasshouse (Apps, install from a file) or
  webOS Dev Manager

### Which TVs

| | TVs | What to expect |
| --- | --- | --- |
| **Tested** | LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401, Chromium 79, Glasshouse 0.118.0 | Everything in this README |
| **Very likely** | other webOS 6 sets (2021, "webOS 6.0") | Same browser engine, not tried |
| **Untested** | webOS 7, 9, 10, 11 ("webOS 23" to "webOS 26"), OLED C and G series | No idea. That is what testers are for |
| **Not supported** | a TV without root, without the Homebrew Channel or without Glasshouse | The launcher is an app, but the hub needs a root shell |

## Install

Two routes that work, and the scripts, which are experimental and not the place to start.

| Route | How | Needs | Updates |
| --- | --- | --- | --- |
| **Homebrew Channel** | add one repository address, install from the channel | a rooted TV with the channel | come by themselves |
| By hand | Glasshouse → Apps → *install from a file* | the IPK | install the new IPK again |
| Scripts | `tools/install-launcher.sh`, `tools/install-hub.sh` | `curl`, `python3`, SSH | **experimental** |

The launcher is one IPK, and since 0.5.3 the hub travels inside it. It starts with the app and stops
with it, which needs no shell at all. Running the hub all the time is the optional second step.

### 1. Homebrew Channel

This is how the other launchers in the scene are distributed, and from now on the normal way here
too. The channel reads a repository file, and every later version arrives through it without you
doing anything.

1. Homebrew Channel on the TV, *Settings*, *Add repository*
2. paste this address:

```text
https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
```

3. CleanFrame appears in the channel's app list, install it there
4. start CleanFrame once from the app list; it writes its configuration on first start

The address points at the newest release, so it never has to change. If you would rather pin what
you install, the same file is in the repository as [`repo/apps.json`](repo/apps.json)
(`raw.githubusercontent.com/TheLord83/CleanFrame-webos/main/repo/apps.json`). `tools/make-apps-json.py`
writes both from the built IPK, with hash, size, manifest and download URL.

### 2. By hand, five minutes

Useful when the channel is not installed yet, or when you want to see exactly which file goes onto
the TV.

1. get the IPK from the [latest release](https://github.com/TheLord83/CleanFrame-webos/releases/latest),
   or build one: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk --hub web`
2. Glasshouse → Apps → *install from a file* → pick the IPK → confirm the version prompt
3. start CleanFrame once from the app list

### The settings page in the browser

The hub is the part with the browser interface: Home Assistant values, the entity selection, MQTT,
the remote, backup and restore. It is a node process on the TV, and the IPK carries it, so after an
install from the channel you open

```text
http://<tv-ip>:8484/
```

and the page is there. `app/hubboot.js` starts the server through the Homebrew Channel's service when
CleanFrame starts, waits until it answers, and stops it when the app goes away. Nothing permanent
happens on the TV, no shell, no root, no autostart entry.

The trade is time. A bundled hub lives as long as the launcher's web page does. Put another app on
screen and it keeps answering, because webOS keeps the page in the background; after a reboot nothing
runs until CleanFrame starts once, and that is the case this exists for. Measured on the test TV: the
page answered for four seconds after the start, and stayed up while another app was in front.

If you want the page to answer while the TV is showing something else, install the hub for good. That
needs a root shell and installs the autostart hook:

```sh
./tools/install-hub.sh --tv <tv-ip>
```

or by hand:

```sh
scp -r web root@<tv-ip>:/var/lib/cleanframe
ssh root@<tv-ip> 'chmod +x /var/lib/cleanframe/cleanframectl && /var/lib/cleanframe/cleanframectl restart'
```

Both modes use the same configuration file, and a hub installed for good wins: the bundled one sees
port 8484 taken and stays quiet, so there is never a second server. Details, including the autostart
hook: [docs/INSTALL.md](docs/INSTALL.md).

### 3. The scripts (experimental)

There are three: `install-launcher.sh` (IPK through Glasshouse, no SSH), `install-hub.sh` (the hub
over SSH) and `install.sh` (both, and it never roots anything). They are written, they run, and they
have been used on exactly one TV: the 43NANO779PA in this README. No second model, no second webOS
version, no Windows machine and no macOS.

Use one of the routes above unless you want to debug them. They find the TV on the network, build
the IPK, upload it and verify the result, which is convenient, but each of those steps is a guess
about your network.

```sh
./tools/install-launcher.sh --tv <tv-ip>     # the app, no SSH
./tools/install-hub.sh --tv <tv-ip>          # the settings page, SSH as root
./tools/install.sh --tv <tv-ip>              # both
./tools/install.sh --info                    # model, webOS, node, root state
```

They stop instead of guessing: no Glasshouse means no install, a non-root session means no hub.
`--dry-run` prints the plan, `--lang de` answers in German, `--help` lists the rest.

## Removing it

Uninstall CleanFrame from the channel or from Glasshouse, and the app is gone. If the bundled hub
ran, one thing stays behind: `/var/lib/cleanframe/config.json`, which holds the Home Assistant token
and the MQTT password. That directory belongs to a permanent install as well, so nothing deletes it
automatically. Remove it yourself if you want it gone:

```sh
ssh root@<tv-ip> 'rm -rf /var/lib/cleanframe'
```

A permanent hub is removed properly by `./tools/uninstall-web.sh <tv-ip>`: it stops the service,
drops the autostart hook and deletes the directory in one go.

## Build and test

```sh
python3 tools/build-ipk.py app ipk/cleanframe_all.ipk --hub web   # IPK, hub included
tools/check-all.sh                                      # all checks, no TV required
tools/make-port-patch.sh                                # refresh docs/PORT-CHANGES.patch
```

`tools/check-all.sh` starts its own configuration server and a headless Chrome, then runs syntax,
node 8 compatibility, icon, API, remote-key, live-apply and link checks in one go. Details in
[docs/TESTS.md](docs/TESTS.md). The same script runs in CI on every push.

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md): from a stock TV to a running start screen
- [docs/ROOTING.md](docs/ROOTING.md): what root is for, and where it comes from
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): symptom, cause, command
- [docs/WEB.md](docs/WEB.md): hub API endpoints, configuration schema, operating the service
- [docs/TESTS.md](docs/TESTS.md): what is tested and how
- [docs/ICONS.md](docs/ICONS.md): icon library and its sources
- [docs/asset-sources.md](docs/asset-sources.md): every photograph, its photographer and its licence
- [docs/PORT-CHANGES.patch](docs/PORT-CHANGES.patch): full difference to upstream

## Differences to upstream

`app/device.js` is new. `app/main.js` has a contained delta (webOS app IDs, LG labels, remote
handling, test hooks), `app/style.css` has Chromium 79 compatibility fixes, `app/i18n.js` and
`app/appinfo.json` are new, and `app/config.xml` (Tizen packaging) is gone. Everything under
`app/assets/` keeps the original files untouched: everything that was there is byte-identical, apart
from `SOURCES.json` and `PHOTO-CREDIT.md`, which were extended, and everything else is new.

## Warranty and risk

Rooting and sideloading third-party packages can affect warranty and DRM features; install at your
own risk. The app ID is `com.blackpearl.cleanframe`, and it installs through Glasshouse's sideload
path like any other homebrew app. What is tested and what is not: see [Which TVs](#which-tvs).

## Problems and questions

Open an [issue](https://github.com/TheLord83/CleanFrame-webos/issues) for anything that is not a
security problem. A report is worth ten times more with the model, the webOS version and a photo of
the screen. Security problems go to the **Security** tab of the repository, *Report a
vulnerability*, not into a public issue.

## Licence and credits

- Port code (webOS bridge, packaging, build scripts): MIT, see [LICENSE](LICENSE). Both copyright
  lines are in there, the original one and the port's
- Original CleanFrame: MIT, Nathan Clark
- Interface and assets come from CleanFrame: MIT for code, separate terms for fonts (OFL), icons
  (CC0/MIT) and photos (Unsplash Licence). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
  [docs/asset-sources.md](docs/asset-sources.md)
- Brands such as Netflix, YouTube or Disney+ belong to their owners. This project claims no
  affiliation and no endorsement

Deutsche Fassung: [README.de.md](README.de.md)
