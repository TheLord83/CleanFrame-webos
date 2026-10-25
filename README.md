# cleanframe-webos

**Inoffizielle Portierung von [CleanFrame](https://github.com/nthnclrk/CleanFrame) auf
LG-Fernseher mit webOS 6 oder neuer.** Nicht mit dem Original verbunden, nicht vom
ursprünglichen Autor betreut.

CleanFrame wurde für Samsung The Frame (Tizen) geschrieben: ein Foto, eine große Uhr und die
eigenen Apps statt eines überladenen Hersteller-Startbildschirms. Diese Portierung übernimmt
den Originalcode unverändert — Oberfläche, Fokus-Logik, Einstellungen, Wandbilder, Materialien —
und ersetzt nur die Geräteanbindung: `app/device.js` spricht statt Tizen den lokal auf dem
Fernseher laufenden [Glasshouse](https://github.com/rorygallagher2024/glasshouse)-Server an.

## Was anders ist als beim Original

| Datei | Änderung |
| --- | --- |
| `app/device.js` | vollständig neu: App-Start, Startseite, TV-Einstellungen und Bildschirmschoner über die native Luna-Brücke (`PalmServiceBridge`), App-Liste und Icons über Glasshouse (`/api/apps`, `/api/apps/icon`), inklusive eingebauter System-Apps (Browser, Homebrew Channel, Media Player), die Glasshouse nicht führt |
| `app/main.js` | Marken-Kacheln auf webOS-App-IDs, `safeIcon` erlaubt TV-Icons über `http://127.0.0.1:8080/…`, sichtbare Texte „Samsung" → „LG", „Art Mode" → „Bildschirmschoner", Kontextmenü per langem OK, Leiste auf Inhalt zugeschnitten, Prüfschnittstelle `window.CleanFrameDebug` |
| `app/i18n.js` | neu: Deutsch und Englisch, englische Strings als Schlüssel, Sprache über `localStorage['cleanframe.lang']` |
| `app/style.css` | Chromium-79-Verträglichkeit: kein `inset`, kein Flex-`gap` (Geschwisterabstände statt `gap`), größere Marken, TV-Icons einfarbig |
| `app/assets/` | unverändert (byte-identisch zum Original) |
| `app/appinfo.json` | neu: webOS-Paketbeschreibung, Kategorie `home` |
| `app/config.xml` | entfernt (Tizen-Verpackung) |

Der komplette Unterschied als anwendbarer Patch: [`PORT-CHANGES.patch`](PORT-CHANGES.patch) —
damit lässt sich ein neues Upstream-Release in Minuten nachziehen.

## Umfang

Dock mit Fokus-Linse und Glas-Materialien, Listen-Layout, Hintergrund Foto/Hell/Dunkel,
15 Wandbilder mit Rotation, Typografie, Fokus- und Materialstile, Apps-Browser mit den
installierten Apps des Fernsehers, eigener „Apps on Home"-Editor, Uhr, LG Home und
TV-Einstellungen.

## Voraussetzungen

* LG-Fernseher mit webOS 6 oder neuer, **gerootet** (Homebrew Channel installiert)
* Glasshouse auf dem Fernseher, erreichbar auf `127.0.0.1:8080`
* IPK-Installation über `luna://com.webos.appInstallService/dev/install` oder das
  Glasshouse-Dashboard (Apps → Sideload)

## Bauen

```sh
python3 tools/build-ipk.py app ipk/cleanframe_all.ipk
```

Erzeugt ein ar-Archiv mit `debian-binary`, `control.tar.gz` und `data.tar.gz`
(`usr/palm/applications/<id>/` plus `usr/palm/packages/<id>/packageinfo.json`).

Weitergeben (Quellpaket mit allen Lizenztexten):

```sh
tools/build-public.sh
```

## Einrichtung ohne Fernbedienung

Ein zweiter, eigenständiger Dienst auf dem Fernseher liefert die Konfiguration
über eine JSON-API und eine Web-Oberfläche (`http://<tv-ip>:8484`). Damit lassen
sich Startseite, Darstellung, Sprache und Integrationen am Rechner einstellen,
statt mit der Fernbedienung durch Menüs zu laufen.

```sh
./tools/install-web.sh 192.168.1.50      # Server + Autostart
/var/lib/cleanframe/cleanframectl status # auf dem Fernseher
```

Details, vollständige API-Tabelle und Sicherheitsmodell: [`docs/WEB.md`](docs/WEB.md).

Prüfbar ohne Fernseher:

```sh
python3 tools/test-web-api.py            # 16 HTTP-Prüfungen
```

## Getestet

* LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401 (`kisscurl-koli`), Chromium 79, gerootet
* Glasshouse 0.118.0 als Anbindung
* Installation über den Glasshouse-Sideload-Weg, App-ID `com.blackpearl.cleanframe`

Keine Zusage für andere Modelle. Root und fremde IPKs können Garantie- und DRM-Funktionen
beeinflussen; das Installieren erfolgt auf eigenes Risiko.

## Lizenz und Grenzen

* Eigener Code (webOS-Anbindung, Verpackung, Bau-Skripte): MIT — siehe [`LICENSE`](LICENSE),
  dort stehen beide Copyright-Zeilen (Original und Portierung).
* Oberfläche und Assets stammen aus CleanFrame: MIT für den Code, getrennte Bedingungen für
  Schriften (OFL), Icons (CC0/MIT) und Fotos (Unsplash License). Alles in
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), Foto-Quellen in
  [`wallpaper-SOURCES.json`](wallpaper-SOURCES.json).
* Marken wie Netflix, YouTube oder Disney+ gehören ihren Inhabern. Dieses Projekt behauptet
  keine Zugehörigkeit oder Unterstützung.
