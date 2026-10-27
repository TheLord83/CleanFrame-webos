# Rooting — and why this page mostly points somewhere else

CleanFrame runs on a rooted TV. It does not root one.

The short version: use the **[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)**.
Their guide explains the paths per generation, they keep up with firmware updates, and if
something goes wrong there are more people who have seen it than there are here. Everything
in this repository expects a TV that already has root and SSH.

The rest of this page documents the path that was actually used on the test TV in this
repository, because it existed before this project and it would be dishonest to leave it
out. It is unsupported, it is not part of installing CleanFrame, and it can cost you your
warranty or your mainboard.

## What root is needed for

| | without root | with root |
| --- | --- | --- |
| the launcher (start screen, tiles, clock, wallpapers) | no — Glasshouse installs the IPK | yes |
| the hub (settings page in the browser, live picture, remote) | no | yes — it writes to `/var/lib` and starts at boot |
| Home Assistant values, MQTT, screenshots | no | yes, they live in the hub |
| hiding LG's promo rows, blocking update hosts | no | yes |

So: without root you get a start page. With root you get the settings page next to it.
That is the whole reason the two installs are separate.

## The supported path

1. Homebrew Channel installed — their guide, their prerequisites
2. Glasshouse installed from the Homebrew Channel's app list, opened once
3. back to [INSTALL.md](INSTALL.md): the IPK, or `./tools/install-launcher.sh`

Nothing in steps 1 and 2 is this project's business, and neither is the outcome.

## The path that was used here (unsupported)

`tools/root/root-it.sh` is the script from the very beginning of this project. It is in the
repository so that the path is documented instead of remembered.

```sh
./tools/root/root-it.sh --tv 192.168.1.50
./tools/root/root-it.sh --tv 192.168.1.50 --firmware 03.51.16   # scripted, no prompt
./tools/root/root-it.sh --tv 192.168.1.50 --dry-run             # gate only, changes nothing
```

What it does:

1. asks the TV about itself without touching the screen (`tools/tvinfo.py`: SSDP, DIAL,
   AirPlay, SSAP) — model, and webOS if it is feeling talkative
2. asks for the firmware version if the TV will not say, and judges it with
   `tools/root/rootaly.py`
3. fetches [SlopBro](https://github.com/throwaway96/slopbro) and runs it against the TV's
   browser; one pairing prompt appears on screen and has to be accepted with the remote
4. waits for the root shell, writes your public key to `/home/root/.ssh/authorized_keys`,
   switches `webosbrew_sshd_enabled` on, closes Telnet, blocks the LG update hosts
   (`tools/root/tvsetup.py` does this part)

If the firmware is above the exploit's ceiling, it stops before touching anything.

### The firmware decides, not the model

An unrooted TV will not tell you its firmware: `config/getConfigs`,
`settings/getSystemSettings` and `update/getCurrentSWInformation` all answer
`401 not registered` without a paired session. So the script asks, then judges only what
the published rules cover (`tools/root/rootaly.py`):

- platform `kisscurl` (NANO77/NANO79, W21A) with SlopBro: up to firmware **03.53.45** —
  an exact yes or no once the firmware is known; without it the verdict stays `unknown`
  but names the ceiling
- webOS 4.x: faultmanager is still open there → yes
- webOS 5, 6, 7, 9, 10: the build decides → `unknown`, with a pre-filled link to
  <https://cani.rootmy.tv>
- no model or no version → `unknown`

`--force` overrides a `no`, for the case where you know better than the table. The
exploit itself keeps the last word either way.

Where the number is on the TV, with screenshots: [FIRMWARE.md](FIRMWARE.md)
(German: [FIRMWARE.de.md](FIRMWARE.de.md)).

### Do this immediately afterwards

SlopBro leaves the Chrome DevTools port 9998 open. While it is reachable from the LAN,
anyone on the network can run code on the TV. Keep it on loopback:

```sh
ssh root@<tv-ip> 'iptables -I INPUT ! -i lo -p tcp --dport 9998 -j DROP'
```

Make it survive reboots with a hook in `/var/lib/webosbrew/init.d/`. The hub needs 9998 on
loopback for the live picture and the remote, so do not block `lo`.

### Doing it by hand instead

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/lgtv
python3 tools/root/tvsetup.py --tv <ip> --key ~/.ssh/lgtv.pub   # key, sshd, Telnet off, updates blocked
```

## What nobody here can promise

Rooting a TV is a change to a device you own, done with an exploit against a specific
firmware. There is no warranty, no undo button, and a wrong firmware can leave you with a
TV that needs a service technician. That is exactly why it does not belong in an installer
for a start screen.
