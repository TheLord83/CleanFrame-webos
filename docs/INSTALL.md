# Install

> Source: <https://github.com/TheLord83/CleanFrame-webos>, where this file is
> [`docs/INSTALL.md`](https://github.com/TheLord83/CleanFrame-webos/blob/main/docs/INSTALL.md).
> Issues and questions: <https://github.com/TheLord83/CleanFrame-webos/issues>.

Two things end up on the TV. The launcher is the start screen itself, an ordinary app in an IPK.
The CleanFrame Hub is the settings page in the browser, a node process on the TV, and since 0.5.3 the
same IPK carries it.

The bundled hub starts with the app and stops with it, so a channel install alone gives you a working
settings page and no SSH at all. Installing the hub for good is the second, optional step: it needs a
root shell and adds an autostart entry, and in return the page answers while the TV shows something
else.

## What you need

- an LG TV with webOS, rooted, with the Homebrew Channel installed. Rooting is not described here.
  [ROOTING.md](ROOTING.md) explains why the Homebrew Channel is the answer and not this repository
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installed and opened once. It
  accepts the IPK, and the launcher reads its app list from it
- a computer in the same network, only if you want the hub to run permanently or use one of the
  scripts. Setting things up through the browser needs nothing but the TV
  (Windows)

## Three ways to get the launcher on the TV

| | How | Needs | Status |
| --- | --- | --- | --- |
| **Homebrew Channel** | add one repository address, install from the channel | a rooted TV with the channel | works, and updates come by themselves |
| by hand | Glasshouse → Apps → *install from a file* | the IPK | works, five minutes |
| script | `./tools/install-launcher.sh --tv <ip>` | `curl`, `python3` | **experimental**, see the end of this page |

The channel is how the other webOS launchers are distributed, and it keeps itself up to date. If it
is not on the TV yet, install it first, since it also installs its own packages.

## Homebrew Channel

1. Homebrew Channel on the TV, *Settings*, *Add repository*
2. add this address:

```text
https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
```

3. CleanFrame shows up in the channel's list, install it there
4. start it once from the app list

The address resolves to the newest release, so it never changes. For a pinned version, the same file
is in the repository as `repo/apps.json`
(`https://raw.githubusercontent.com/TheLord83/CleanFrame-webos/main/repo/apps.json`).
`tools/make-apps-json.py` writes both from the built IPK, with hash, size, manifest and download
URL.

## By hand, five minutes

1. get an IPK: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk --hub web`, or the file from a
   release. The `--hub` part is what puts the settings page into the package
2. Glasshouse → **Apps** → *install from a file* → pick the IPK → confirm the version
3. start CleanFrame once from the app list; it writes its configuration on first start and starts the
   bundled hub
4. open `http://<tv-ip>:8484/` from a phone or a laptop in the same network
5. the next section is optional: it makes that page survive the app

## The hub, bundled

The IPK carries the hub under `hub/` next to the app. `app/hubboot.js` asks port 8484 first; if
nothing answers there it starts the server through `luna://org.webosbrew.hbchannel.service/exec`, which
is the Homebrew Channel's service and runs as root, waits until `/api/health` answers, and only then
lets the launcher read its configuration. When the app goes away it stops the process again.

Three things follow from that, and all three are intended:

- the configuration is the same file a permanent hub uses (`/var/lib/cleanframe/config.json`), so
  switching between the two modes keeps your settings
- a hub installed for good wins. The bundled one sees the port taken and does nothing, and the stop
  call only ever matches the copy inside the app directory
- without the Homebrew service, or without `node` on the TV, nothing happens: the launcher runs on its
  localStorage configuration exactly as before, and the settings page is simply not there. The reason
  lands in `/var/lib/cleanframe/hub-bundled.log`

It stops when the app's page unloads, which in practice means a reboot or a real teardown of the web
app. webOS keeps the page in the background when another app comes to the front, so the page keeps
answering there. What is measured on the test TV (43NANO779PA, webOS 6.5): app started, hub on 8484
after four seconds with version 0.5.3, the same `/var/lib/cleanframe/config.json` as a permanent
install, and one process, never two.

## The hub, for good (optional, needs root)

Installed this way the hub serves the settings page on port 8484 permanently, keeps the
configuration, sends a live picture of the TV and holds the remote. It is the only part that needs
SSH, and it is four commands:

```sh
ssh root@<tv-ip> 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets'
scp -r web/server.js web/lib web/assets web/cleanframectl root@<tv-ip>:/var/lib/cleanframe/
scp web/init.d/52-cleanframe root@<tv-ip>:/var/lib/webosbrew/init.d/
ssh root@<tv-ip> 'chmod +x /var/lib/cleanframe/cleanframectl /var/lib/webosbrew/init.d/52-cleanframe && /var/lib/cleanframe/cleanframectl restart'
```

The third line is the autostart hook. Without it the hub is gone after the next reboot.
`tools/install-hub.sh` does the same and refuses a TV that is not rooted; it is experimental, see
the end of this page.

Settings for the service (a token, a certificate bundle) go into `/var/lib/cleanframe/hub.env`, one
assignment per line; `cleanframectl` reads it on every start. Details in [WEB.md](WEB.md).

What lands where:

| Path | Content |
| --- | --- |
| `/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe` | the launcher |
| `/var/lib/cleanframe/server.js`, `lib/`, `assets/` | the hub, when installed for good |
| `.../applications/com.blackpearl.cleanframe/hub/` | the same hub inside the app package |
| `/var/lib/cleanframe/hub-bundled.log` | what the bundled hub said when it started |
| `/var/lib/cleanframe/config.json` | the whole configuration, `0600` |
| `/var/lib/cleanframe/cleanframe.log`, `client.log` | hub log, browser messages |
| `/var/lib/webosbrew/init.d/52-cleanframe` | autostart at boot |
| port 8484 | web interface and API, LAN only |

Control the hub over SSH:

```sh
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl status'     # running, health
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl restart'    # after a change
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl logs'       # last 40 lines
```

Removal: `./tools/uninstall-web.sh <tv-ip>`. The launcher stays installed.

## First start

1. the app is in the app list as CleanFrame; start it once
2. the first start opens the setup: language, wallpaper, senior mode
3. with the hub installed, open `http://<tv-ip>:8484/` from the TV browser, a phone or a laptop in
   the same network
4. the app reads its configuration from the hub and follows changes within about two seconds

Without the hub the app still runs, but every setting lives in the app and nothing is shared with a
browser.

## Which version am I running?

| Where | What it shows |
| --- | --- |
| `./tools/install.sh --info` | `launcher: 0.5.1` and `hub: 0.5.1` (from this checkout) |
| hub, **System** → *Television* | model, webOS, firmware, kernel, hub and node version, read on the TV |
| `GET /api/tv/info` | the same as JSON |
| `GET /api/health` | `{"ok":true,...,"version":"0.5.1"}` |
| Glasshouse's app list | the installed launcher version, which is the only number that counts |

## Updating

```sh
./tools/install-launcher.sh --tv <ip>     # builds and installs the current IPK
./tools/install-hub.sh --tv <ip>          # copies the current server over the old one
```

The configuration survives both, because `config.json` is not part of either copy. Take a backup
first if you have been fiddling: **System** → *Download backup*, or
`curl -sS http://<tv-ip>:8484/api/backup > backup.json`.

Reinstalling replaces the app folder, which closes a running launcher, so the script starts it again
afterwards.

## Uninstall

```sh
./tools/uninstall-web.sh <tv-ip>      # hub: service, autostart, /var/lib/cleanframe
```

The launcher is an app: remove it in Glasshouse's app list or in the Homebrew Channel. Neither
removal touches LG's own apps or the Home screen.

## Doing it without the scripts

The scripts only wrap these calls:

```sh
# launcher: exactly what install-ipk.py does
curl -sS -X POST http://<ip>:8080/api/apps/install/sideload -H 'Content-Type: application/json' -d '{"enabled":true}'
curl -sS -X POST --data-binary @cleanframe_all.ipk -H 'Content-Type: application/octet-stream' http://<ip>:8080/api/apps/install/upload
curl -sS http://<ip>:8080/api/apps/install/status          # then confirm with the jobId

# hub
scp -r web root@<ip>:/var/lib/cleanframe
ssh root@<ip> 'chmod +x /var/lib/cleanframe/cleanframectl && /var/lib/cleanframe/cleanframectl restart'
```

Do not try `luna-send` from the SSH shell. On webOS 6.5 it has no `-w`, and even
`applicationManager/listApps` returns nothing with exit code 0. Glasshouse's installer is the
reliable path, and it is the same one the Homebrew Channel uses.

## The scripts (experimental)

`tools/install-launcher.sh`, `tools/install-hub.sh` and `tools/install.sh` (both of the others in
one run, and it never roots anything) are the convenient way in. They are also the least tested part
of this repository, written against one TV, one webOS version and one network, on Linux.

Use them if you want to debug them or install the same thing more than once. Otherwise the manual
paths above are shorter and you can see what happens.

```sh
# Linux and macOS
./tools/install-launcher.sh --tv <tv-ip>          # the app: no SSH, no root
./tools/install-hub.sh --tv <tv-ip>               # the settings page: SSH as root
./tools/install.sh --tv <tv-ip>                   # both
./tools/install.sh --tv <tv-ip> --info            # model, webOS, node, root state
./tools/install-launcher.sh --dry-run             # find and print the plan only
```

```powershell
# Windows (PowerShell): same stages, same switches, one dash
.\tools\install.ps1 -Tv <tv-ip>
.\tools\install.ps1 -Tv <tv-ip> -LauncherOnly
.\tools\install.ps1 -Tv <tv-ip> -DryRun -Lang de
```

What they do, in order: find the TV (the ARP table first, then a sweep of the local /24 for a host
that answers Glasshouse's `/api/apps`), check that Glasshouse answers, build the IPK if you did not
pass one, upload it through Glasshouse's installer, read the app list back to prove the version, and
start the app once. The hub script does the same check for root, refuses a non-root session and
copies the server.

Both stop instead of guessing: no Glasshouse means no install, a non-root session means no hub.
`--dry-run` prints the plan, `--lang de` answers in German, `--help` lists the rest.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `No Glasshouse on <ip>` | Glasshouse missing, not started, or on another port. Install it from the Homebrew Channel and open its dashboard once |
| `No TV answering on port 8080` | TV off or in standby (then it answers nothing), another network, or Glasshouse down. Pass `--tv <ip>` |
| install reports success, app missing | Glasshouse's app list is the truth. Reload it; the ID must be `com.blackpearl.cleanframe` |
| `the session is not root` | the hub needs root, the launcher does not. Use `--launcher-only` |
| hub does not answer on 8484 | `ssh root@<ip> "tail -30 /var/lib/cleanframe/hub.log"`. After a reboot it needs a few seconds |
| empty app bar in the launcher | the launcher reads the app list from Glasshouse. Glasshouse down, or no apps installed |
| screen dark after an update | the app was replaced while running: start CleanFrame once from the app list |

You do not need the network search when you know the address. The container in
[../tools/container/](../tools/container/README.md) exists for the case where the TV is in another
network: Debian slim with `python3`, `openssh-client`, `curl` and `git`, the repo mounted in, and
`--network host`.

More in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
