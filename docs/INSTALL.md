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

| | How | Needs | Status |
| --- | --- | --- | --- |
| **by hand** | Glasshouse → Apps → *install from a file* | the IPK | works |
| Homebrew Channel | a repository file from a release | nothing, the channel has it | needs the release |
| script | `./tools/install-launcher.sh --tv <ip>` | `curl`, `python3` | **experimental**, see the end of this page |

The second one is how the other webOS launchers are distributed and how this one will be once
there is a public release. Until then: do it by hand, it is five minutes.

## By hand, five minutes

1. get an IPK: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`, or the file from
   a release
2. Glasshouse → **Apps** → *install from a file* → pick the IPK → confirm the version
3. start CleanFrame once from the app list; it writes its configuration on first start
4. done. The hub is optional

## The hub — optional, needs root

The hub serves the settings page on port 8484, keeps the configuration, sends a live picture of
the TV and holds the remote. It is the only part that needs SSH, and it is four commands:

```sh
ssh root@<tv-ip> 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets'
scp -r web/server.js web/lib web/assets web/cleanframectl root@<tv-ip>:/var/lib/cleanframe/
scp web/init.d/52-cleanframe root@<tv-ip>:/var/lib/webosbrew/init.d/
ssh root@<tv-ip> 'chmod +x /var/lib/cleanframe/cleanframectl /var/lib/webosbrew/init.d/52-cleanframe && /var/lib/cleanframe/cleanframectl restart'
```

The autostart hook is the third line: without it the hub is gone after the next reboot. There is
also `tools/install-hub.sh`, which does exactly this and refuses a TV that is not rooted — it is
experimental, see the end of this page.

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

## The scripts — experimental

`tools/install-launcher.sh`, `tools/install-hub.sh` and `tools/install.sh` (both of the others
in one run, never rooting anything) are the convenient way in. They are also the least tested
part of this repository: written against one TV, one webOS version, one network, on Linux.

Use them if you want to debug them or install the same thing more than once. Otherwise the
manual paths above are shorter, because you can see what happens.

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

What they do, in order: find the TV (ARP table, then a sweep of the local /24 for a host that
answers Glasshouse's `/api/apps`), check that Glasshouse answers, build the IPK if you did not
pass one, upload it through Glasshouse's installer, read the app list back to prove the version,
start the app once. The hub script does the same check for root, refuses a non-root session, and
copies the server.

They stop instead of guessing: no Glasshouse means no install, a non-root session means no hub.
`--dry-run` prints the plan, `--lang de` answers in German, `--help` lists the rest.

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
