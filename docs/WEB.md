# CleanFrame Hub: configuration server and web interface

The launcher keeps its configuration in one JSON file. A small HTTP server on the
TV (`com.blackpearl.cleanframe.web`) serves the file over a JSON API and hosts a
browser interface, so the home screen can be set up from a laptop instead of a
remote control.

Design follows [Glasshouse](https://github.com/rorygallagher2024/glasshouse)
(`tvweb.js`): one dependency-free Node process, `/api/*` routes, static assets
from `assets/`, optional token, and local requests always allowed.

## Install

```sh
./tools/install.sh 192.168.1.50          # launcher and hub, with verification (experimental)
./tools/install-hub.sh 192.168.1.50      # hub only (experimental)
```

That copies the server to `/var/lib/cleanframe/`, installs the boot hook
`/var/lib/webosbrew/init.d/52-cleanframe` and starts the service. Then open
`http://<tv-ip>:8484/`.

Removal: `./tools/uninstall-web.sh 192.168.1.50`, and the launcher stays installed.

## Service control (on the TV)

```sh
/var/lib/cleanframe/cleanframectl status|start|stop|restart|logs
```

Paths are read from `/var/lib/cleanframe/config.json`; port defaults to 8484 and
can be changed with `CF_PORT`.

## API

All responses are JSON. `PUT`/`POST` require `Content-Type: application/json`
and a same-origin `Origin` header; anything else is refused (415 / 403). This
mirrors Glasshouse's `postGuard`, because a cross-site `POST` with a "simple"
content type is delivered by the browser without a preflight.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | version, uptime, config path, whether a token is required |
| GET | `/api/config` | current configuration, secrets redacted (`hasToken` / `hasPassword`) |
| PUT | `/api/config` | store configuration (empty secret = keep stored one) |
| GET | `/api/apps` | app catalogue: Glasshouse `/api/apps` plus built-in apps |
| GET | `/api/diag` | readiness checks (config dir, root, Glasshouse, SSAP) |
| POST | `/api/ha/check` | verify a Home Assistant URL/token against `/api/` |
| GET | `/api/ha/entities` | entities that make sense on a tile (sensor, light, climate, …) |
| GET | `/api/ha/values` | current values for the selected entities (`?entities=a.b,c.d`) |
| POST | `/api/ha/toggle` | switch one selected light/switch/helper (`{"entity_id": "…"}`) |
| GET | `/api/backup` | configuration as a download (`cleanframe-backup-<date>.json`) |
| POST | `/api/backup` | import such a file |
| GET | `/api/selftest` | built-in assertions about validation, redaction, storage |
| POST | `/api/system/restart` | restart the service (exit 0, the boot hook or `cleanframectl` brings it back) |

### Configuration schema

```json
{
  "schemaVersion": 1,
  "lang": "system",
  "look": { "layout": "dock", "apps": "both", "wall": "misty", "font": "manrope", "clock": true },
  "home": [
    { "appId": "netflix", "name": "Filme" },
    { "appId": "com.webos.app.hdmi2", "name": "PlayStation" }
  ],
  "integrations": {
    "ha": { "url": "http://192.168.1.30:8123", "token": "…" },
    "mqtt": { "url": "mqtt://192.168.1.30:1883", "user": "…", "password": "…", "prefix": "cleanframe" }
  }
}
```

`home` entries may override `name` and `icon`. The catalogue under "All apps" on the television
keeps the original app name and icon.

Validation lives on the server (`web/lib/config.js`), not in the interface:
unknown languages fall back to `system`, entries without `appId` are dropped, and
duplicate `appId`s are removed.

## Home Assistant tile and screensaver

`integrations.ha.entities` holds up to 12 entity ids (each optionally with a
`label`); `/api/ha/values` returns name, state and unit for exactly those, which
is what the status strip renders. Only display-worthy domains are offered; `automation.*`, `zone.*` and similar are filtered out on
the server.

### The values page on the TV

`Einstellungen -> Werte auf der Startseite` lists exactly the entities chosen in
the hub. `left`/`right` switches between the checkbox and the name, `OK` either
hides the value from the strip or opens the on-screen keyboard for a shorter
name. Nothing can be added there; the 1747 entries stay in the browser.

A hidden value keeps its place in the hub selection (`shown: false` in
`integrations.ha.entities`), so the hub still offers it and the TV can bring it
back without setting everything up again.

### Switching from the strip

`POST /api/ha/toggle` with `{"entity_id": "light.wohnzimmer"}` calls
`/api/services/<domain>/toggle` in Home Assistant and returns the new state from
the answer. Only `light`, `switch`, `input_boolean` and `fan` are accepted. Anything else answers 400 and never
reaches Home Assistant, because a cover needs up/stop/down and a lock needs a question.

On the TV, `down` from the dock moves focus into the strip, `left`/`right` picks a
chip, `OK` switches. The chip flips as soon as the answer arrives and a refused
switch shows a red edge for four seconds. The list layout has no free direction
for a fourth zone, so there the chips only display.

### Status strip on the home screen

The chosen entities appear as a strip of value chips above the dock: own label
(or the Home Assistant name), value, unit. Read-only, refreshed every 60 s and
immediately whenever the configuration changes. No selection, no strip.

- A `label` in the configuration wins over the Home Assistant name, which is what keeps a tile
  readable at three metres.
- States are translated in the interface, not on the server: `on` → `An`,
  `off` → `Aus`, `open` → `Offen` … A `binary_sensor` gets the contact wording
  (`on` → `Offen`, `off` → `Geschlossen`), because "An" would be wrong for a
  window.
- `unavailable` and `unknown` stay as they are on the server and are shown as
  `Nicht verfügbar` / `Unbekannt`; the unit is dropped with them, so a dead
  sensor does not read like a measurement of zero.
- Numbers are rounded for the display (one decimal below 100, integers above):
  Home Assistant delivers `26.9494692484538 %`.

Measured on the 43NANO779PA (webOS 6.5, firmware 03.51.16): three chips,
`Temperatur 24.1 °C | Wohnzimmer An | Fenster Geschlossen`, strip bottom at
264 px with the dock starting at 274 px, so nothing overlaps. A label change in
the hub is on screen within a second without a restart.

`screensaver` controls the coupling to the TV screensaver:

```json
"screensaver": { "enabled": true, "minutes": 10, "variant": "starfield" }
```

`minutes` is clamped to 1…120. The launcher starts the screensaver after that
idle time; `variant` empty means the Glasshouse default.

## First-run wizard, senior mode and interface language

On a fresh configuration (`onboarding.done: false`) the interface opens a
five-step wizard: language (app and interface), a few quick tiles, layout and
type size, summary, done. Skipping or finishing sets `onboarding.done: true`;
the wizard is never shown again but stays reachable from the settings.

```json
"ui": { "senior": false, "textScale": 100, "cursor": "focus" },
"onboarding": { "done": false, "version": 1 }
```

`textScale` is clamped to 50…200 %, `cursor` accepts `focus` or `off`. Senior
mode is what the launcher uses for larger labels and fewer tiles per screen.

The interface itself switches between German and English (`DE`/`EN` in the
header) independently of the app language; the choice is kept in the browser
(`localStorage["cf.ui.lang"]`).

## Interface languages (language files)

Every visible string of the interface lives in a language file, not in the markup:

| File | Content |
| --- | --- |
| `web/assets/lang/de.js` | German strings |
| `web/assets/lang/en.js` | English strings, same keys |
| `web/lib/schema.js` | option names, German in `name`, English in `nameEn` |
| `web/lib/diag.js` | check names, German in `label`, English in `labelEn` |

The keys are flat and dotted (`nav.home`, `card.accent.title`), both files are loaded as
scripts (so the page also works from disk), and `t("key", {n: 5})` substitutes `{n}`
placeholders. A missing key falls back to German and logs
`missing i18n key: <key>` to the console instead of showing an empty label.

`name` and `label` stay German on purpose: the launcher on the TV reads them. The
interface picks `nameEn` / `labelEn` when English is selected and the German field otherwise, so
translating the hub needs nothing changed on the device.

Language parity is checked without a browser:

```sh
node tools/check-lang.js      # identical key sets in both files, prints RESULT n/n
```

Switching the language in the header re-renders the page (static `data-t` elements,
settings cards, tile list, visible status lines) and is stored in
`localStorage["cf.ui.lang"]`; the default stays German. For a headless check the language
can be forced with `?lang=en`, e.g. `chrome --headless=new --dump-dom "http://127.0.0.1:8484/?lang=en"`.

### App language, and why the page reloads

The language of the launcher is a server setting (`lang`, set under Appearance).
When that setting changes, a running launcher reloads itself once, because tiles and labels are
built at startup and the utility bar is never rebuilt. Swapping only the table would leave German
chrome around English values
(exactly what happened on 2026-10-26). `CleanFrameI18n.lang` keeps the language
the page was built with, and `reloadForLanguage()` compares against it; a guard in
`sessionStorage` stops a stale server value from reloading in a loop.

### Two tabs, one configuration

Every write carries `rev`. If the server answers 409, the interface fetches the
newer configuration and re-applies only the fields this tab changed since it last
agreed with the server (`mergeChanged()`), then sends again. Without that a tab
left open for an hour would push its whole stale copy back and wipe what the
launcher or another tab wrote in the meantime.

## Security model

- Without a token everything is allowed; with a token (`CF_TOKEN`) requests must
  carry `Authorization: Bearer …` or `?k=…`.
- Requests from `127.0.0.1` are always allowed: the launcher runs on the TV and
  a process on the TV already has root, so a token would add nothing there.
- Secrets are never returned to the interface. An empty secret in a `PUT` keeps
  the stored value, so the browser never has to hold it.
- The file is written atomically (tmp + rename) with mode 0600.

## Two ways the hub runs

Bundled, it is a child of the launcher: `app/hubboot.js` starts it through the Homebrew Channel's
service, waits for `/api/health`, and kills it when the app closes. Its log is
`/var/lib/cleanframe/hub-bundled.log`. Nothing in `/etc` or `init.d` belongs to it, and `cleanframectl`
does not know about it. That is why `hub.env` only takes effect in the second mode: a bundled hub is
started directly by `node`, not by `cleanframectl`.

It ends when the app's page unloads. While another app is in front, webOS keeps the page and the hub
behind it alive, which is deliberate: the settings page should not die because the TV is showing
something else. After a reboot it is gone until CleanFrame starts once.

Installed for good, it is a service: `cleanframectl start|stop|restart|status|logs`, an init.d hook,
and `hub.env` for the environment.

Both read and write the same `/var/lib/cleanframe/config.json`. If both were asked to, the one that
owns port 8484 answers; the other one notices the port is taken and stays quiet.

## Secrets and TLS

The hub holds two secrets: the Home Assistant token and, if you use it, the MQTT password. Both
live in `/var/lib/cleanframe/config.json` with mode `0600` and neither comes back out through
`/api/config` or `/api/backup`; both answer with an empty string and `hasToken` / `hasPassword`
instead. Reading the file over SSH is the only way to see them again.

`POST /api/ha/check` tests the connection. The stored token is only ever sent to the stored URL:
a check against a different address has to bring its own token, and a redirect is followed only
inside the same host. Without those two rules the endpoint hands a long-lived token to whoever
posts a URL.

Certificates are verified. That is a problem on webOS 6, because node 8.12 ships a trust store from
2018 and does not know the ISRG roots, so a Home Assistant behind Let's Encrypt fails the check even
with a valid certificate. Two ways out, both for the whole process:

| Setting | Effect |
| --- | --- |
| `CF_HA_CA=/etc/ssl/certs/ca-certificates.crt` | trust this bundle as well. `cleanframectl` sets it automatically when the file exists |
| `CF_HA_TLS_INSECURE=1` | switch the check off. Blunt, and then anybody between TV and Home Assistant can read the token |

Put either one in `/var/lib/cleanframe/hub.env`, one assignment per line; `cleanframectl` reads that
file on every start. `CF_TOKEN` also belongs there rather than in a URL: a token passed as `?k=` ends
up in logs and browser history.

The traffic between browser and hub is plain HTTP on port 8484. Whoever types the Home Assistant
token into the web interface sends it through the LAN in clear text, which is acceptable in a home
network and nowhere else. Put TLS in front (a reverse proxy) if the network is shared.

## Tests without the TV

```sh
python3 tools/test-web-api.py        # 39 HTTP checks against a stub catalogue
```

The UI has its own check: open `http://<host>:8484/?selftest=ui`. It clicks
"add", saves, re-reads `/api/config` and writes the result into `#uiSelfTest`
plus the page title (`SELFTEST-OK` / `SELFTEST-FAIL`), so a headless run can
assert the interface without screenshots:

```sh
chrome --headless=new --virtual-time-budget=8000 --dump-dom "http://127.0.0.1:8484/?selftest=ui"
```

## Driving the TV from the interface

The sidebar on the right always shows a picture of the running launcher and a remote
control. Both use two endpoints of the server:

- `GET /api/tv/snapshot?format=jpeg&quality=65`: picture as JPEG (or PNG with `format=png`),
  returned as image data, not JSON.
- `GET /api/tv/keys`: allowed key names.
- `POST /api/tv/key` with `{"keys": ["down", "ok"]}`: up to 12 keys, optionally
  `holdMs` for a long press. The answer says which path was used: `via: "launcher"`
  (fast, DevTools) or `via: "homeassistant"` (the whole TV, see below).
- `GET /api/tv/screenshot.png` / `.jpg`, optional `?width=960&height=540`: the whole screen through
  the TV's capture service; the interface uses the small JPEG for the
  live picture (about 90 KB instead of 1.3 MB).

How it works: the launcher is a Chromium web app whose DevTools console listens on
`127.0.0.1:9998`. To the outside the port is blocked with iptables
(`INPUT ! -i lo --dport 9998 -j DROP`); on loopback it stays reachable, and that is
where the server runs. The server speaks CDP directly (its own small WebSocket client,
no package needed):

- picture: `Page.captureScreenshot`
- keys: `Input.dispatchKeyEvent` (rawKeyDown + keyUp)

Two things to keep in mind for node 8 on the TV: no `readBigUInt64BE` (the 64-bit
lengths are assembled by hand), and the DevTools console keeps HTTP connections open, so the answer
has to be read via `Content-Length` rather than waiting for the connection to end.

### Keys reach the whole TV: own pairing first, Home Assistant last

DevTools keys only move our own launcher: LG's home screen and settings are a different
process and answer `ECONNREFUSED 127.0.0.1:9998` as soon as our app is not in front. The
documented way for the rest of the TV is the SSAP pointer socket
(`ssap://com.webos.service.networkinput/getPointerInputSocket`), which needs a client key
paired with `CONTROL_MOUSE_AND_KEYBOARD`.

The hub brings that pairing itself (`web/lib/ssap.js`, `POST /api/tv/pair`): it registers
over SSAP, the TV asks once on screen, the key is stored in `/var/lib/cleanframe/tv-client-key.json`
(mode 0600) and reused. That is exactly what every webOS remote app does and needs no other
software:

- `GET /api/tv/pair`: `{paired, tv, saved}`.
- `POST /api/tv/pair` with `{"waitSeconds": 120}`: starts the pairing and waits for the answer; `504` with a readable reason when nobody confirms.
- Order for `POST /api/tv/key`: launcher (DevTools) → own SSAP channel → Home Assistant.

Home Assistant is only the last net, for TVs that refuse the prompt (one webOS 6.5 build
shows no dialog at all; measured there: no window on screen, the SSAP connection closes
without a key, while normal notifications do appear). Its `webostv.button` service then
presses the same buttons through the pairing Home Assistant made earlier.

- The Home Assistant path asks for the entity only once per five minutes and takes the
  reachable LG `media_player` (an old registration often stays as `unavailable` forever and
  would swallow every press).
- Key names are translated (`ok` → `ENTER`, `back` → `BACK`, `volup` → `VOLUMEUP`, digits
  to `0`…`9`); the fixed list is in `web/lib/systemkey.js`.
- `integrations.ha.tvEntity` in the configuration pins the entity when discovery picks the
  wrong one.
- Measured on the device: `down` moved the selection, `ok` started an app (about 0.6 and
  1.5 million changed pixels against a screenshot taken before), `back` returned home.

If the app is closed on the TV, the endpoint answers 503 with a plain-text message and
the interface shows "no picture". Starting it again:
`curl -X POST http://<tv-ip>:8080/api/control -d '{"action":"launchApp","value":"com.blackpearl.cleanframe"}'`
Alternatively run `tools/install.sh <tv-ip>`, which starts the app and waits for the picture as part
of its verification.

### Measured on the 43NANO779PA (webOS 6.5, firmware 03.51.16)

What the own channel needs, each point cost a measurement:

* The manifest is the permission. The TV grants only what the registration asks for, and it
  compares against the list aiowebostv (Home Assistant) uses. With eight permissions the TV hands
  out a key that may read the model name and nothing else, and every other request answers
  `401 insufficient permissions`. With the 37 permissions from aiowebostv's `handshake.py` the same
  TV grants volume, app list, inputs and the pointer socket. Copy that list rather than inventing
  one.
* Keep the connection that asked for the socket open. The pointer socket only lives while the
  registering connection is up; closing it first leaves the frames unheard.
* The frame is text, not JSON: `type:button\nname:DOWN\n\n`.
* Client frames must be masked. Without the mask the TV drops them silently.
* One permanent listener on the socket. Frames that arrive between two reads (`recv()`) are
  otherwise lost: the TV's `registered` answer comes so fast after the handshake that this alone
  made every key press end in a timeout.
* `/api/tv/snapshot` can hand back an old picture while `/api/tv/screenshot.png` is always fresh.
  Measure key presses with the screenshot, or you test a frozen frame.

With all of that, `POST /api/tv/key` answers `via: "ssap"` and the keys reach LG's own
menus, with no Home Assistant, no launcher in the foreground and no pairing prompt.

Rollout: the pairing question appears once per TV. `POST /api/tv/pair` opens it,
`GET /api/tv/pair` reports `paired`; the key lands in
`/var/lib/cleanframe/tv-client-key.json` (0600).
