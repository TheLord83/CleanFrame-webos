# Install

Two things end up on the TV: the launcher (the start screen, an IPK) and the
CleanFrame Hub (configuration server plus web interface). This guide goes from a
stock TV to a running start screen.

Read the whole page once before starting. Step 0 cannot be automated and needs your
hands on the remote control.

## What you need

- LG TV with webOS 6 or newer, wired network recommended
- A computer on the same network with `ssh`, `scp` and `python3` (Linux, macOS) or
  PowerShell 5.1/7 with the OpenSSH client (Windows)
- This repository, checked out
- The model number of the TV and its firmware version (Settings → All Settings →
  General → About This TV)

## Step 0 — root the TV (one press on the remote, the rest is scripted)

```sh
./tools/install.sh --root          # finds the TV, roots it, sets up SSH, closes Telnet
./tools/install.sh --root --info   # same, plus a state report first
```

What the script does in this step:

1. **Finds the TV** without an IP address: SSDP search plus a port scan of the local
   /24, verified by a real SSAP websocket handshake and by Glasshouse's `/api/apps`
   answer — so a random web server on port 3000 is not mistaken for a TV.
2. **Reports the state**: model, webOS version, node version, whether it is rooted.
3. **Roots it with [SlopBro](https://github.com/throwaway96/slopbro)**: serves the
   exploit page, opens it on the TV through SSAP, and waits for the root shell
   (Telnet 23).
4. **Finishes the job** once the shell is there: writes your public key to
   `/home/root/.ssh/authorized_keys`, sets `webosbrew_sshd_enabled`, closes Telnet
   (flag off, process killed), and blocks the LG update hosts in `/etc/hosts`.
5. **Verifies**: SSH with the key works, node answers, Telnet is gone.

One thing is left for you, and it is not Developer Mode:

- **Accept the pairing prompt.** SlopBro asks the TV once (SSAP pairing); press *Yes*
  with the remote. That is the only click in the whole flow. If no prompt appears,
  enable *Settings → Connection → LG Connect Apps / Mobile Connection Management* —
  without it the TV refuses SSAP pairing.

**Developer Mode is not required** — and it actively gets in the way: the LG Developer
Mode app must be removed before rooting, its own docs say so, and the webOS Homebrew
project keeps a table of what root can do that Dev Mode cannot (wallpaper, screensaver,
button remapping, PicCap). Dev Mode is the alternative for people who do not want to
root; it is not a step towards rooting.

If the firmware is above the exploit cutoff (check your model on
<https://cani.rootmy.tv>), the run ends without a root shell — the script says so and
stops instead of guessing. A downgrade is not described here.

Module key, if you prefer to do it by hand:

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/lgtv
python3 tools/tvsetup.py --tv <ip> --key ~/.ssh/lgtv.pub   # key, sshd, Telnet off, updates blocked
```

### What is still manual

- **Glasshouse**: install it from the Homebrew Channel catalogue (it is not in the
  catalog of this repo, it ships its own IPK), then open `http://<tv-ip>:8080/` once
  and switch the boot hook on. Automating the IPK install is the next step.
- **Debloat**: turning off ACR, screen recognition and ad tracking, and hiding the
  promo tiles, is done in Glasshouse's dashboard or via its API
  (`POST /api/control`). The script does not touch these yet.

### Close the DevTools port

Rooting opens the Chrome DevTools port 9998. While it is reachable from the LAN,
anyone on the network can run code on the TV. Glasshouse cannot close it, so keep it
on loopback only:

```sh
ssh root@<tv-ip> 'iptables -I INPUT ! -i lo -p tcp --dport 9998 -j DROP'
```

Make it survive reboots with an `init.d` hook (Glasshouse runs everything in
`/var/lib/webosbrew/init.d/` at boot). The hub needs 9998 on loopback for its live
picture and remote control, so do **not** block `lo`.

## Step 1 — run the installer

### Linux and macOS

```sh
./tools/install.sh                   # find the TV, install launcher and hub
./tools/install.sh --root            # same, but root the TV first
./tools/install.sh --info            # only report model, webOS version, node
./tools/install.sh --lang de         # German prompts
./tools/install.sh --dry-run         # detect, check and print the plan only
./tools/install.sh 192.168.1.50      # explicit address instead of the search
```

```text
$ ./tools/install.sh
==> Looking for the TV
    found: 192.168.1.50
==> Checking prerequisites
    node 8.12.0
    Glasshouse answers (192.168.1.50:8080)
==> Plan
    install the launcher IPK: /path/to/dist/cleanframe_all.ipk
    set up the hub: /var/lib/cleanframe, autostart, port 8484
Proceed? [Y/n] y
==> Installing the launcher
   uploading 15802724 bytes
   confirming com.blackpearl.cleanframe 0.4.17
   installed: com.blackpearl.cleanframe 0.4.17 (16750825 bytes)
==> Setting up the hub
==> Verifying
    hub answers: {"ok":true,...,"version":"0.4.17"}
    launcher is in the app list: com.blackpearl.cleanframe 0.4.17
    launcher is on screen (live picture available)
==> Result
    interface: http://192.168.1.50:8484/
```

### Windows (PowerShell)

```powershell
.\tools\install.ps1                 # find the TV, install launcher and hub
.\tools\install.ps1 -Root           # same, but root the TV first
.\tools\install.ps1 -Info           # only report model, webOS version, node
.\tools\install.ps1 -Lang de -DryRun
.\tools\install.ps1 -Tv 192.168.1.50
```

Needs the OpenSSH client (Windows optional feature) and Python 3 on `PATH` for `-Root` and
the network search — the upstream tools are Python.

```text
PS> .\tools\install.ps1 -DryRun
==> Looking for a TV on the network
    found: 192.168.1.50
==> Checking prerequisites
    node 8.12.0
    Glasshouse answers (192.168.1.50:8080)
==> Plan
    install the launcher IPK: C:\...\dist\cleanframe_all.ipk
    set up the hub: /var/lib/cleanframe, autostart, port 8484

(dry run: nothing was changed)
```

### Flow and options

Both scripts follow the same flow: **(find) → (info) → (root) → check → plan → confirm →
install → verify → report**. Nothing is written before the single confirmation dialog, and
every stage is skipped when it is already done — on a running hub, on an already rooted TV,
on an existing IPK.

| What you want | Linux and macOS | Windows (PowerShell) |
| --- | --- | --- |
| find the TV automatically | *(no argument)* | *(no argument)* |
| use a known address | `--tv 192.168.1.50` | `-Tv 192.168.1.50` |
| root the TV without asking | `--root` | `-Root` |
| do not root, launcher only | `--no-root` | `-NoRoot` |
| report model, webOS, node | `--info` | `-Info` |
| use an existing IPK | `--ipk <file>` | `-Ipk <file>` |
| German prompts | `--lang de` | `-Lang de` |
| launcher only | `--no-launcher` | `-NoLauncher` |
| hub only | `--no-hub` | `-NoHub` |
| detect and plan only | `--dry-run` | `-DryRun` |
| no confirmation dialog | `--yes` | `-Yes` |
| send Wake-on-LAN first | `--wake` | *(wake the TV by hand)* |
| your own SSH public key | `--ssh-key <file.pub>` | `-SshKey <file.pub>` |

The two columns differ only in the spelling that each shell expects: `--name` in a POSIX
shell, `-Name` in PowerShell (single dash, parameter names are case-insensitive, so `-tv`
works as well). Nothing behaves differently.

### Root is checked, not assumed

The first thing the installer does is ask the TV whether it already has a root shell
(`ssh root@<tv> id -u`). Then:

- **root works** → it says so and goes on.
- **no root** → it offers to root the TV (`Root it now? [Y/n]`), because the launcher runs
  without root but the hub does not. Answer `n` (or pass `--no-root` / `-NoRoot`) and it
  installs the launcher only and says that the hub was skipped.

### TV in another network?

The installer must run in the same network as the TV (SSDP, SSAP, SSH, and it serves the
exploit page itself). If your machine is somewhere else — a TV at a relative's flat, say —
use the container in [../tools/container/](../tools/container/README.md): Debian slim with
`python3`, `openssh-client`, `curl` and `git`, the repo mounted in, `--network host`.

The installer ends with three proofs: the hub answers on port 8484, the app id shows up in
the app list, and the hub can take a picture of the launcher (which means it is really on
screen, not just installed).

### What was installed

| Path | Content |
| --- | --- |
| `/media/developer/apps/usr/palm/applications/com.blackpearl.cleanframe` | the launcher |
| `/var/lib/cleanframe/server.js`, `lib/`, `assets/` | the hub |
| `/var/lib/cleanframe/config.json` | configuration (0600) |
| `/var/lib/cleanframe/cleanframe.log`, `client.log` | hub log, browser messages |
| `/var/lib/webosbrew/init.d/52-cleanframe` | autostart at boot |
| port 8484 | web interface and API, LAN only |

Control the hub over SSH:

```sh
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl status'    # running, health
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl restart'   # after a change
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl logs'      # last 40 lines
```

Then open `http://<tv-ip>:8484/`. Everything in the interface is saved automatically
after 350 ms and shows up on the TV within about two seconds.

## Step 2 — first start

1. Open the hub, tab **Home screen**, and put your apps on the start screen: name, icon,
   order. The catalogue contains installed apps, HDMI inputs and system apps.
2. Tab **Appearance**: wallpaper, layout, clock, language, senior mode.
3. Tab **Integrations**: Home Assistant URL and token, MQTT broker.
4. Tab **System**: run the setup wizard again, take a backup of the configuration.

The launcher reads the configuration from the hub at start and every two seconds.
Without the hub it starts with the embedded defaults — the hub is the convenience,
not a requirement for the app to run.

## Updating

```sh
git pull
./tools/install.sh 192.168.1.50          # rebuilds the IPK and reinstalls both parts
```

`install.sh` builds the IPK from `app/` with `tools/build-ipk.py`, so the installed
version always matches the checkout. Reinstalling replaces the app folder — a running
launcher is closed by that, which is why the installer starts it again and waits for
a picture.

## Uninstall

```sh
ssh root@<tv-ip> '/var/lib/cleanframe/cleanframectl stop'
ssh root@<tv-ip> 'rm -rf /var/lib/cleanframe /var/lib/webosbrew/init.d/52-cleanframe'
```

Remove the app itself in Glasshouse → Apps, or with the Homebrew Channel.

## Doing it without the scripts

The scripts only wrap these commands:

```sh
# launcher
python3 tools/build-ipk.py app dist/cleanframe_all.ipk
python3 tools/install-ipk.py --tv <tv-ip> --ipk dist/cleanframe_all.ipk

# hub
tools/install-web.sh <tv-ip>
```

`install-ipk.py` uploads through Glasshouse's own installer
(`/api/apps/install/sideload` → `upload` → `status` → `confirm`). Do not try
`luna-send` from the SSH shell: on webOS 6.5 it has no `-w`, and even
`applicationManager/listApps` returns nothing with exit code 0.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
