# Install

> Source: <https://github.com/TheLord83/CleanFrame-webos> — this file lives in the repo at
> [`docs/INSTALL.md`](https://github.com/TheLord83/CleanFrame-webos/blob/main/docs/INSTALL.md).
> Issues and questions: <https://github.com/TheLord83/CleanFrame-webos/issues>.

Two things end up on the TV:

- the **launcher**, the start screen itself. It is an IPK, an ordinary app.
- the **CleanFrame Hub**, the settings page in the browser. It is a node process on the TV
  and it needs root.

The launcher works without the hub. The hub does not work without root. So this page
installs the two separately, and only one of them needs SSH.

## What you need

- an LG TV with webOS, **rooted**, with the Homebrew Channel installed. Rooting is not
  described here — [ROOTING.md](ROOTING.md) explains why the Homebrew Channel is the
  answer and not this repository
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installed and opened once:
  it accepts the IPK, and the launcher reads its app list from it
- a computer in the same network. For the launcher: a shell with `curl`. For the hub:
  `ssh`, `scp`, `python3` (Linux, macOS) or PowerShell with the OpenSSH client (Windows)

## Three ways to get the launcher on the TV

| | How | Needs | Updates |
| --- | --- | --- | --- |
| by hand | Glasshouse → Apps → *install from a file* | the IPK | install the new IPK again |
| script | `./tools/install-launcher.sh --tv <ip>` | `curl`, `python3` to build the IPK | run it again |
| Homebrew Channel | a repository file from a release | nothing, the channel has it | the channel does it |

The third one is how the other webOS launchers are distributed and how this one will be
once there is a public release. Until then: the first or the second.

## Way 1 — by hand, five minutes

1. get an IPK: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`, or the file from
   a release
2. Glasshouse → **Apps** → *install from a file* → pick the IPK → confirm the version
3. start CleanFrame once from the app list; it writes its configuration on first start
4. done. The hub is optional

## Way 2 — the launcher script

No SSH, no root, nothing to be root for: it talks to Glasshouse on port 8080, the same door
the Homebrew Channel uses.

### Linux and macOS

```sh
./tools/install-launcher.sh                    # find the TV, build the IPK, install it
./tools/install-launcher.sh --tv 192.168.1.50
./tools/install-launcher.sh --ipk cleanframe_all.ipk   # a release IPK instead
./tools/install-launcher.sh --dry-run          # find and print the plan only
./tools/install-launcher.sh --lang de          # German prompts
```

```text
$ ./tools/install-launcher.sh
Looking for the TV on the network ...
TV: 192.168.1.50
Glasshouse answers (192.168.1.50:8080)
Building the IPK from app/ ...
Installing com.blackpearl.cleanframe
Installed: com.blackpearl.cleanframe 0.4.41
Started. The start page should be on the TV now.
Next: the settings (values on the start page, Home Assistant) need the hub:
./tools/install-hub.sh 192.168.1.50
```

### Windows (PowerShell)

`tools/install.ps1` does the same with the same stages; the flags differ only in spelling
(`-Tv`, not `--tv`).

```powershell
.\tools\install.ps1 -Tv 192.168.1.50
.\tools\install.ps1 -Tv 192.168.1.50 -LauncherOnly
.\tools\install.ps1 -Tv 192.168.1.50 -DryRun -Lang de
```

## The hub — optional, needs root

The hub serves the settings page on port 8484, keeps the configuration, sends a live
picture of the TV and holds the remote. It is the only part that needs SSH:

```sh
./tools/install-hub.sh --tv 192.168.1.50
./tools/install-hub.sh --tv 192.168.1.50 --lang de
```

```text
$ ./tools/install-hub.sh --tv 192.168.1.50
TV: 192.168.1.50
SSH as root, uid=0
node 8.12.0 on the TV
Copying the hub to /var/lib/cleanframe ...
Setting up the autostart ...
Starting the service ...
Hub is running: http://192.168.1.50:8484/   (API: /api/health, /api/config, /api/apps)
Removal: ./tools/uninstall-web.sh 192.168.1.50 (the launcher stays).
```

Against a TV that is not rooted it stops instead of trying:

```text
SSH answers, but the session is not root (uid=1000). The hub writes to /var/lib and needs
root. Rooting is not part of this script: see docs/ROOTING.md, or install only the launcher
with ./tools/install-launcher.sh.
```

What lands where:

| Path | Content |
| --- | --- |
| `/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe` | the launcher |
| `/var/lib/cleanframe/server.js`, `lib/`, `assets/` | the hub |
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

## Both parts in one run

`tools/install.sh` wraps the two scripts above: the launcher always, the hub only when the
TV is rooted. It never roots a TV itself.

```sh
./tools/install.sh                    # launcher, plus hub when rooted
./tools/install.sh --launcher-only    # no SSH at all
./tools/install.sh --hub-only         # hub on an already installed launcher
./tools/install.sh --info             # model, webOS, node, root — changes nothing
./tools/install.sh --dry-run
./tools/install.sh --lang de
```

`--info` is a report, never a step: it prints what the TV answers and exits.

## Step 3 — first start

1. the app is in the app list as **CleanFrame**; start it once
2. the first start opens the setup: language, wallpaper, senior mode
3. with the hub installed, open `http://<tv-ip>:8484/` — from the TV browser, a phone or a
   laptop in the same network
4. the app reads its configuration from the hub and follows changes within about two
   seconds

Without the hub the app still runs, but every setting lives in the app and nothing is
shared with a browser.

## Which version am I running?

| Where | What it shows |
| --- | --- |
| `./tools/install.sh --info` | `launcher: 0.5.0` and `hub: 0.5.0` (from this checkout) |
| hub, **System** → *Television* | model, webOS, firmware, kernel, hub and node version, read on the TV |
| `GET /api/tv/info` | the same as JSON |
| `GET /api/health` | `{"ok":true,...,"version":"0.5.0"}` |
| Glasshouse's app list | the installed launcher version — the only number that counts |

## Updating

```sh
./tools/install-launcher.sh --tv <ip>     # builds and installs the current IPK
./tools/install-hub.sh --tv <ip>          # copies the current server over the old one
```

The configuration survives both: `config.json` is not part of either copy. Take a backup
first if you have been fiddling — **System** → *Download backup*, or
`curl -sS http://<tv-ip>:8484/api/backup > backup.json`.

Reinstalling replaces the app folder, which closes a running launcher; the script starts it
again afterwards.

## Uninstall

```sh
./tools/uninstall-web.sh <tv-ip>      # hub: service, autostart, /var/lib/cleanframe
```

The launcher is an app: remove it in Glasshouse's app list or in the Homebrew Channel.
Neither removal touches LG's own apps or the Home screen.

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

Do not try `luna-send` from the SSH shell: on webOS 6.5 it has no `-w`, and even
`applicationManager/listApps` returns nothing with exit code 0. Glasshouse's installer is
the reliable path, and it is the same one the Homebrew Channel uses.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `No Glasshouse on <ip>` | Glasshouse missing, not started, or on another port. Install it from the Homebrew Channel and open its dashboard once |
| `No TV answering on port 8080` | TV off or in standby (then it answers nothing), another network, or Glasshouse down. Pass `--tv <ip>` |
| install reports success, app missing | Glasshouse's app list is the truth. Reload it; the ID must be `com.blackpearl.cleanframe` |
| `the session is not root` | the hub needs root. The launcher does not — use `--launcher-only` |
| hub does not answer on 8484 | `ssh root@<ip> "tail -30 /var/lib/cleanframe/hub.log"`. After a reboot it needs a few seconds |
| empty app bar in the launcher | the launcher reads the app list from Glasshouse. Glasshouse down, or no apps installed |
| screen dark after an update | the app was replaced while running: start CleanFrame once from the app list |

The network search is not needed when you know the address; the container in
[../tools/container/](../tools/container/README.md) exists for the case where the TV is in
another network (Debian slim with `python3`, `openssh-client`, `curl`, `git`, repo mounted,
`--network host`).

More in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
