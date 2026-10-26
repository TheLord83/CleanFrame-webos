# CleanFrame Hub — configuration server and web interface

The launcher keeps its configuration in one JSON file. A small HTTP server on the
TV (`com.blackpearl.cleanframe.web`) serves the file over a JSON API and hosts a
browser interface, so the home screen can be set up from a laptop instead of a
remote control.

Design follows [Glasshouse](https://github.com/rorygallagher2024/glasshouse)
(`tvweb.js`): one dependency-free Node process, `/api/*` routes, static assets
from `assets/`, optional token, and local requests always allowed.

## Install

```sh
./tools/install.sh 192.168.1.50          # launcher and hub, with verification
./tools/install-web.sh 192.168.1.50      # hub only
```

That copies the server to `/var/lib/cleanframe/`, installs the boot hook
`/var/lib/webosbrew/init.d/52-cleanframe` and starts the service. Then open
`http://<tv-ip>:8484/`.

Removal: `./tools/uninstall-web.sh 192.168.1.50` — the launcher stays installed.

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

`home` entries may override `name` and `icon` — the catalogue in "All apps" on
the television always shows the original app name and icon.

Validation lives on the server (`web/lib/config.js`), not in the interface:
unknown languages fall back to `system`, entries without `appId` are dropped, and
duplicate `appId`s are removed.

## Home Assistant tile and screensaver

`integrations.ha.entities` holds up to 12 entity ids (each optionally with a
`label`); `/api/ha/values` returns name, state and unit for exactly those, which
is what the tile renders. Only display-worthy domains are offered —
`automation.*`, `zone.*` and similar are filtered out on the server, and
`unavailable`/`unknown` render as `–`.

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
interface picks `nameEn` / `labelEn` when English is selected, otherwise the German
field — so nothing has to be changed on the device to translate the hub.

Language parity is checked without a browser:

```sh
node tools/check-lang.js      # identical key sets in both files, prints RESULT n/n
```

Switching the language in the header re-renders the page (static `data-t` elements,
settings cards, tile list, visible status lines) and is stored in
`localStorage["cf.ui.lang"]`; the default stays German. For a headless check the language
can be forced with `?lang=en`, e.g. `chrome --headless=new --dump-dom "http://127.0.0.1:8484/?lang=en"`.

## Security model

- Without a token everything is allowed; with a token (`CF_TOKEN`) requests must
  carry `Authorization: Bearer …` or `?k=…`.
- Requests from `127.0.0.1` are always allowed: the launcher runs on the TV and
  a process on the TV already has root, so a token would add nothing there.
- Secrets are never returned to the interface. An empty secret in a `PUT` keeps
  the stored value, so the browser never has to hold it.
- The file is written atomically (tmp + rename) with mode 0600.

## Tests (no television required)

```sh
python3 tools/test-web-api.py        # 33 HTTP checks against a stub catalogue
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

- `GET /api/tv/snapshot?format=jpeg&quality=65` — picture as JPEG (or PNG with
  `format=png`), returned as image data, not JSON.
- `GET /api/tv/keys` — allowed key names.
- `POST /api/tv/key` with `{"keys": ["down", "ok"]}` — up to 12 keys, optionally
  `holdMs` for a long press. The answer says which path was used: `via: "launcher"`
  (fast, DevTools) or `via: "homeassistant"` (the whole TV, see below).
- `GET /api/tv/screenshot.png` / `.jpg`, optional `?width=960&height=540` — the whole
  screen through the TV's capture service; the interface uses the small JPEG for the
  live picture (about 90 KB instead of 1.3 MB).

How it works: the launcher is a Chromium web app whose DevTools console listens on
`127.0.0.1:9998`. To the outside the port is blocked with iptables
(`INPUT ! -i lo --dport 9998 -j DROP`); on loopback it stays reachable, and that is
where the server runs. The server speaks CDP directly (its own small WebSocket client,
no package needed):

- picture: `Page.captureScreenshot`
- keys: `Input.dispatchKeyEvent` (rawKeyDown + keyUp)

Two things to keep in mind for node 8 on the TV: no `readBigUInt64BE` (the 64-bit
lengths are assembled by hand), and the DevTools console keeps HTTP connections open —
so the answer has to be read via `Content-Length`, not via the connection ending.

### Keys reach the whole TV — through Home Assistant

DevTools keys only move our own launcher: LG's home screen and settings are a different
process and answer `ECONNREFUSED 127.0.0.1:9998` as soon as our app is not in front. The
documented way for the rest of the TV is the SSAP pointer socket
(`ssap://com.webos.service.networkinput/getPointerInputSocket`), which needs a client key
paired with `CONTROL_MOUSE_AND_KEYBOARD`. This firmware grants that only during pairing and
shows no pairing prompt at all, so the server takes the second path: Home Assistant is
already paired with this TV, and its `webostv.button` service presses the same buttons.

- The server asks Home Assistant for the entity only once per five minutes and takes the
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
— or simply run `tools/install.sh <tv-ip>`, which starts the app and waits for the
picture as part of its verification.
