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

## Step 0 — root the TV (manual, cannot be automated)

The launcher is a normal webOS app; it does **not** need root. The hub does, and
installing IPKs comfortably does too.

1. Look up your model on <https://cani.rootmy.tv>. The page lists whether a public
   exploit exists for your firmware and which one.
2. If your firmware is newer than the last supported one: rooting is not possible
   without a downgrade, and downgrades are not described here.
3. Follow the instructions for your exploit. In practice this means: enable
   **Developer Mode** (Settings → General → Developer Mode), note the passphrase,
   run the exploit from a computer, and wait for the "Here's your slop, bro!" page.
4. Install the **Homebrew Channel** from the resulting web page.
5. After the reboot, log in over SSH (`root`, empty password at first) and set a key:

   ```sh
   ssh-keygen -t ed25519 -N '' -f ~/.ssh/lgtv
   ssh-copy-id -i ~/.ssh/lgtv.pub root@<tv-ip>     # or paste into /home/root/.ssh/authorized_keys
   ```

6. **Close Telnet** (port 23) as soon as SSH works. Glasshouse does this when you
   switch it on; by hand it is
   `touch /var/lib/webosbrew/sshd_enabled` plus removing the telnet autostart.
7. Install **Glasshouse** from the Homebrew Channel (it is in the catalog). Open it
   once at `http://<tv-ip>:8080/` and switch on the boot hook.

Turn off TV updates before going further; a firmware update can remove the exploit.
Glasshouse → Settings → *Block TV updates*.

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

Linux / macOS:

```sh
./tools/install.sh 192.168.1.50
./tools/install.sh 192.168.1.50 --lang de
./tools/install.sh 192.168.1.50 --dry-run        # detect and check only
```

Windows (PowerShell):

```powershell
.\tools\install.ps1 -Tv 192.168.1.50
.\tools\install.ps1 -Tv 192.168.1.50 -Lang de -DryRun
```

Both scripts follow the same flow: **detect → check → plan → confirm → install →
verify → report**. Nothing is written before the single confirmation dialog. Options:

| Option (bash / PowerShell) | Meaning |
| --- | --- |
| `--tv <ip>` / `-Tv <ip>` | address of the TV (or first positional argument) |
| `--ipk <file>` / `-Ipk <file>` | use this IPK instead of building one |
| `--lang en\|de` / `-Lang en\|de` | prompts in English (default) or German |
| `--no-launcher` / `-NoLauncher` | only set up the hub |
| `--no-hub` / `-NoHub` | only install the launcher |
| `--dry-run` / `-DryRun` | detect, check and print the plan, change nothing |
| `--yes` / `-Yes` | skip the confirmation (for scripts) |
| `--wake` | send Wake-on-LAN if port 22 is closed (bash only) |

The installer ends with three proofs: the hub answers on port 8484, the app id shows
up in the app list, and the hub can take a picture of the launcher (which means it
is really on screen, not just installed).

## Step 2 — what was installed

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

## Step 3 — first start

1. Open the hub, tab **Startseite**, and put your apps on the home screen: name, icon,
   order. The catalogue contains installed apps, HDMI inputs and system apps.
2. Tab **Darstellung**: wallpaper, layout, clock, language, senior mode.
3. Tab **System**: start the setup wizard again, take a backup of the configuration.

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
