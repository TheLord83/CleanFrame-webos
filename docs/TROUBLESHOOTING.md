# Troubleshooting

Every entry here was hit and fixed on a real 43NANO779PA (webOS 6.5.0, Chromium 79). Each one names
the symptom, what causes it, and what to do.

## The installer

**`ERROR: cannot ssh root@<ip>`**
The TV is not rooted yet, or no key is in `/home/root/.ssh/authorized_keys`, or port
22 is closed because the TV is in standby.
```sh
ping -c1 <tv-ip>; nc -z -w3 <tv-ip> 22   # reachable at all?
ssh -v root@<tv-ip>                       # where does it stop?
```
Wake the TV by hand or with `--wake` (Wake-on-LAN; the TV setting *Turn on via mobile
device* must be on).

**`ERROR: Glasshouse does not answer on port 8080`**
Glasshouse is not installed or not running. After a boot it needs about 30 seconds,
because its boot hook starts it late.
```sh
curl -s http://<tv-ip>:8080/api/apps | head -c 200
```
An empty answer means: open the Homebrew Channel, start Glasshouse, try again.

**`ERROR: no IPK: pass --ipk <file>`**
`tools/build-ipk.py` needs `python3` and the `app/` directory. On Windows, build the
IPK on Linux, macOS or in WSL and pass `-Ipk .\dist\cleanframe_all.ipk`.

**`ERROR: install reported, but com.blackpearl.cleanframe is missing`**
The upload finished, but the package is not in the catalogue. Usually the app id in
the IPK differs from the expected one.
```sh
python3 tools/install-ipk.py --tv <tv-ip> --ipk dist/cleanframe_all.ipk --app-id <id-from-appinfo.json>
```

**`sleep: invalid number '0.2'`**
The busybox `sleep` on webOS rejects fractions. Every `sleep` in scripts that run
**on the TV** must use whole seconds. Fixed in `cleanframectl`; if you write your own
`init.d` hook, keep it to `sleep 1`.

## The launcher

**The hub shows no picture, `/api/tv/snapshot` answers 503**
The launcher is not running. Installing or updating the app closes it, and the TV
returns to its own home screen after a while.
```sh
curl -sS -X POST http://<tv-ip>:8080/api/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"launchApp","value":"com.blackpearl.cleanframe"}'
```
Then `curl -s -o /dev/null -w '%{http_code}' http://<tv-ip>:8484/api/tv/snapshot`
should give 200.

**Renaming a tile or changing its icon does nothing on the TV**
Historic: the rebuild key for a rendered row contained neither name nor icon, so the
row counted as unchanged. Fixed in 0.4.11; the key now contains id, name, icon and a rebuild
counter. If you carry the patch forward, keep these three parts in the
key.

**A new wallpaper is not applied**
Setting `look.wall` alone only changes the value, not the picture. The image files
have to be loaded and swapped: `setLook(patch, {transient: true})`. Fixed in 0.4.14.

**Senior mode and the text size have no effect**
Two separate causes: the CSS selectors missed the list view (`.ph-name`, not
`.label`), and tile names were drawn with a fixed pixel size (88/56 px) that CSS
cannot override. Both fixed in 0.4.14/0.4.15; labels are multiplied by
`ui.textScale / 100`.

**Changes from the browser never arrive**
The launcher applies a new configuration only when no real dialog is open. Older
builds blocked on every subpage (`S.stack.length > 1`), so a change while the
settings were open never arrived. Fixed in 0.4.13.

**"Save" reports a conflict (HTTP 409)**
Two writers at the same time; the older revision loses. The hub answers with 409 and
the current state, the browser repeats the write once with the new revision. In the
API: send `rev` with your `PUT`, and handle 409 by re-reading `/api/config`.

**`TypeError: new URL is not a constructor` (or similar)**
The TV runs node 8.12. No `new URL`, no `mkdirSync({recursive:true})`, no
`readBigUInt64BE`, no modern `http.get()` signature. `tools/check-node8.py` finds
these before the deploy:
```sh
python3 tools/check-node8.py
```

## The hub

**`/api/health` unreachable right after `cleanframectl restart`**
The node process needs a moment. `install-hub.sh` waits for `"ok":true`; if you
call `cleanframectl restart` yourself, poll:
```sh
until ssh root@<tv-ip> 'curl -sS -m3 http://127.0.0.1:8484/api/health' | grep -q '"ok":true'; do sleep 1; done
```

**Home Assistant: "no connection (301)"**
The check used `http.get` even for https addresses, so HA's proxy answered with a 301
redirect to https and the check called it a failure. Fixed: the check picks the
protocol from the URL and follows up to three redirects. If it still fails, test the
URL and token by hand:
```sh
curl -s -H "Authorization: Bearer <token>" https://<ha-host>/api/ | head -c 120
```

**Home Assistant: "unable to verify the first certificate" or "self signed certificate"**
Certificates are checked, and node 8.12 on webOS 6 does not know the ISRG roots that Let's Encrypt
uses, so a valid certificate fails there too. Point the hub at a bundle:
```sh
ssh root@<tv-ip> 'echo CF_HA_CA=/etc/ssl/certs/ca-certificates.crt >> /var/lib/cleanframe/hub.env && /var/lib/cleanframe/cleanframectl restart'
```
If the certificate is genuinely self-signed and there is no bundle, `CF_HA_TLS_INSECURE=1` turns the
check off, at the price that the token is readable by anything on the way.

**`POST /api/ha/check` answers 400 with "braucht einen eigenen Token"**
It refuses to send the stored token to an address that is not the stored one. Save the URL first, or
pass the token for the new address along with the check.

**The web interface shows 200 but the browser shows an old version**
The hub serves `assets/index.html` from disk; after an update, restart the hub and
reload with `Ctrl+Shift+R`. Check the build stamp in the header and
`/api/health` (`version`).

**Writes are rejected with 403 from the browser**
The hub accepts JSON only, and only from a matching origin (the same guard Glasshouse
uses). Requests from the local machine are always allowed. A reverse proxy in front
must forward `Host` and `Origin` unchanged.

## Remote control and live picture

**Keys do nothing, snapshot works**
Key names have to be in the `remote.KEYS` list; unknown names are rejected with 400
instead of 503 so the cause is visible. `POST /api/tv/key {"keys":["ok"],"holdMs":900}`
presses and holds.

**Long press does not open the tile menu**
The launcher triggers at 650 ms. Shorter presses count as a normal OK. `holdMs: 900`
is a safe value.

## TV and network

**Port 9998 is reachable from the LAN**
Anyone in the network could run code on the TV. Block it outside loopback:
```sh
ssh root@<tv-ip> 'iptables -I INPUT ! -i lo -p tcp --dport 9998 -j DROP'
```
The hub needs 9998 on `127.0.0.1`, so do not block `lo`.

**Port 23 (telnet) is still open after rooting**
It closes on the next boot once `webosbrew_sshd_enabled` is set. Verify:
```sh
ssh root@<tv-ip> 'netstat -lntp | grep ":23 "'
```

**A firmware update broke the root**
Turn updates off before using the TV in daily life: Glasshouse → Settings → *Block
TV updates* writes 26 LG hosts into `/etc/hosts`, which survives reboots. Re-rooting
after an update is usually impossible without a downgrade.

**The reverse proxy answers 400**
The proxy has to pass `Host` and `X-Forwarded-Proto`; for Home Assistant behind a
proxy, `use_x_forwarded_for` and `trusted_proxies` must be set. For the hub, only the
origin guard matters.

## Tests

```sh
tools/check-all.sh          # everything that works without a TV
python3 tools/test-web-api.py
node    tools/test-ui-keys.js
```

A check counts as passed only when it exits 0 **and** prints its summary line. An earlier
version of `tools/test-live-apply.js` ended with 0 without running a single check and looked green
for a day. See [TESTS.md](TESTS.md).
