# Pruefungen

Alles, was ohne Fernseher pruefbar ist, laeuft mit einem Befehl:

```bash
tools/check-all.sh
```

Das Skript startet selbst einen Konfigurations-Server (Port 8484) und ein
kopfloses Chrome (Port 9333) und raeumt beides am Ende wieder ab. `--keep` laesst
beide laufen, wenn man von Hand nachmessen will.

## Die vier Ebenen

**1. Syntax** — `node --check` ueber alle Quelldateien in `app/`, `web/` und `tools/`.

**2. node 8** — `tools/check-node8.py`. Der Fernseher laeuft mit node **8.12**.
Alles, was erst in spaeteren Fassungen existiert (`new URL`, `mkdirSync({recursive})`,
`readBigUInt64BE`, die neue `http.get()`-Signatur), faellt hier auf, bevor es auf dem
Geraet einen Absturz ausloest.

**3. Icons** — `tools/check-icons.py` prueft, dass jede Icon-Kennung in der
Konfiguration eine Datei hat und umgekehrt.

**4. Konfigurations-Server** — `tools/test-web-api.py` startet den Server mit einem
Stub-Katalog und einer temporaeren Konfiguration und prueft jeden Endpunkt:
`/api/health`, `/api/config` (GET/PUT/POST mit 403/409/415), `/api/schema`,
`/api/wall/<id>`, `/api/apps`, `/api/diag`, Home-Assistant-Bruecke, Backup,
`/api/tv/key` mit Langdruck. Erwartung: 33/33.

## Oberflaeche

**Tasten** — `tools/test-ui-keys.js` laedt die Startseite in Chrome, ersetzt die
Geraeteanbindung durch eine Attrappe und schickt echte Tastendruecke ueber
`Input.dispatchKeyEvent`. Deckt Navigation, Kontextmenue, Umbenennen, Sprachwahl,
Uhrformat, Einstellungsseiten und die Geometrie ab. Erwartung: 26/26.

**Live-Uebernahme** — `tools/test-live-apply.js` ist die Antwort auf die Fehler vom
25.10.2026: Kachelname und Icon blieben alt, weil der Aufbau-Schluessel sie nicht
enthielt; das Wandbild wurde nur als Wert gesetzt, die Bilddatei blieb; die
Schriftgroesse stand fest in Pixel. Der Test setzt eine feste Ausgangskonfiguration,
aendert sie ueber die HTTP-Schnittstelle und misst das **sichtbare Ergebnis** im DOM:

- Kachelname in der Listenansicht
- Icon-Wechsel in der Listenansicht
- Wandbild: Dateiname des geladenen Bildes
- Schriftgroesse 150 % → 132 px
- Senioren-Modus bei 100 % → 110 px, aus → 88 px
- Kachelname in der Leiste unten
- Lade-Rad in der Web-Oberflaeche: laeuft und hoert wieder auf

Erwartung: 9/9.

## Zwei Regeln, die aus Fehlern entstanden sind

**Gemessen wird das sichtbare Ergebnis, nicht der Zustand.** Der Revisionszaehler
war schon hochgezaehlt, waehrend die Anzeige noch alt war — der Fehler blieb
deshalb unbemerkt. Jede Pruefung wartet auf das DOM (bis 12 s).

**Ein Test ohne Ausgabe ist kein bestandener Test.** `check-all.sh` wertet eine
Pruefung nur als bestanden, wenn sie mit 0 endet **und** ihre Zusammenfassung
ausgibt. Am 25.10.2026 fehlte im neuen Test der Aufruf der Hauptfunktion: das
Skript endete mit 0 und ohne eine einzige Pruefung — der Lauf war gruen und
wertlos.

## Was hier nicht geprueft wird

- **Das Geraet.** Installation, Start, echter Bildschirm, Langdruck-Schwelle,
  Kontextmenue per Fernbedienung, Bildschirmschoner: dafuer gibt es
  `tools/install-launcher.sh` und die Sichtpruefung am Fernseher.
- **Glasshouse.** Wird im Test durch eine Attrappe ersetzt; die echte App-Liste
  kommt nur auf dem Geraet.

## Continuous Integration

`.github/workflows/checks.yml` faehrt `tools/check-all.sh` bei jedem Push und
jedem Pull Request auf `ubuntu-24.04` mit node 20 und einem aktuellen Chrome.
