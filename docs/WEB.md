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
./tools/install-web.sh 192.168.1.50
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

## Fernseher aus der Oberflaeche bedienen

Die Seitenleiste rechts zeigt dauerhaft das Bild des laufenden Launchers und eine
Fernbedienung. Beides laeuft ueber zwei Endpunkte des Servers:

- `GET /api/tv/snapshot?format=jpeg&quality=65` — Bild als JPEG/PNG (`format=png`),
  direkt als Bilddaten, nicht als JSON.
- `GET /api/tv/keys` — erlaubte Tastennamen.
- `POST /api/tv/key` mit `{"keys": ["down", "ok"]}` — bis zu 12 Tasten.

Technischer Weg: Der Launcher ist eine Chromium-Web-App, deren DevTools-Konsole
auf `127.0.0.1:9998` lauscht. Nach aussen ist der Port per iptables gesperrt
(`INPUT ! -i lo --dport 9998 -j DROP`), ueber die Loopback-Schnittstelle bleibt er
erreichbar — dort laeuft der Server. Er spricht CDP direkt (eigener kleiner
WebSocket-Client, kein Paket noetig):

- Bild: `Page.captureScreenshot`
- Tasten: `Input.dispatchKeyEvent` (rawKeyDown + keyUp)

Wichtig fuer node 8 auf dem Fernseher: kein `readBigUInt64BE` (64-Bit-Längen von
Hand), und die DevTools-Konsole haelt HTTP-Verbindungen offen — die Antwort muss
ueber `Content-Length` ausgewertet werden, nicht ueber das Verbindungsende.

Ist die App am Fernseher zu, antwortet der Endpunkt mit 503 und einer Klartext-
Meldung; die Oberflaeche zeigt dann "Kein Bild".
