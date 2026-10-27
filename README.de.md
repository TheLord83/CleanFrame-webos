# CleanFrame für webOS

**Inoffizielle Portierung von [CleanFrame](https://github.com/nthnclrk/CleanFrame) auf
LG-Fernseher mit webOS 6 oder neuer.** Nicht mit dem Original verbunden, nicht vom
ursprünglichen Autor betreut.

CleanFrame wurde für Samsung The Frame (Tizen) geschrieben: ein Foto, eine große Uhr und die
eigenen Apps statt eines überladenen Hersteller-Startbildschirms. Diese Portierung übernimmt
den Originalcode — Oberfläche, Fokus-Logik, Einstellungen, Wandbilder, Materialien — und
ersetzt nur die Geräteanbindung: `app/device.js` spricht den lokal auf dem Fernseher laufenden
[Glasshouse](https://github.com/rorygallagher2024/glasshouse)-Server an.

![CleanFrame auf einem 43-Zoll-LG: ein Foto, die Uhr, sechs Kacheln](docs/img/launcher.jpg)

*Die Startseite: ein Foto, die Uhr, die Apps, die wirklich benutzt werden. Gerendert in
1920×1080, ohne Fernseh-Rahmen.*

![CleanFrame Hub: der Tab Startseite mit Reihenfolge, Name und Icon je Kachel und dem Live-Bild des Fernsehers daneben](docs/img/hub-home.jpg)

*Der Hub im Browser: jede Einstellung der App, gespeichert beim Ändern — dazu ein Live-Bild
des Fernsehers und eine Fernbedienung für die Fälle, in denen der Weg zum Sofa zu weit ist.*

**[Im Homebrew Channel eintragen](https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json)** —
eine Adresse, dann installieren und aktualisieren über den Channel. Oder das
[IPK aus dem Release](https://github.com/TheLord83/CleanFrame-webos/releases/latest) nehmen und
in Glasshouse geben. Die Einstellungsseite daneben ist optional.

## Zwei Teile

| Teil | Was es ist | Wo es läuft |
| --- | --- | --- |
| **Launcher** | Die Startseite als webOS-App (`com.blackpearl.cleanframe`), als IPK verpackt | Auf dem Fernseher |
| **CleanFrame Hub** | Konfigurations-Server mit Web-Oberfläche: Einstellungen ändern, Live-Bild holen, Tasten der Fernbedienung senden | Ebenfalls auf dem Fernseher, im LAN erreichbar |

Der Hub ist die maßgebliche Quelle der Konfiguration. Der Launcher liest sie beim Start und
holt sie danach alle zwei Sekunden neu — eine Änderung im Browser ist deshalb in Sekunden auf
dem Bildschirm, ohne Neustart und ohne Neuinstallation.

## Warum Root?

Zwei getrennte Antworten, und genau deshalb ist die Installation zweiteilig:

- der **Launcher** ist eine normale webOS-App. Er braucht einmal Root, weil das Installieren
  eines Pakets auf einem unveränderten Fernseher über den App-Installer läuft und der nur über
  eine Root-Shell erreichbar ist. Danach läuft die App ohne Root.
- der **Hub** bleibt root-only: er liegt in `/var/lib/cleanframe`, startet sich beim Booten
  selbst und liest für das Live-Bild die Interna des Fernsehers. Daran führt kein Weg vorbei.

Root ist also eine Voraussetzung, keine Funktion dieses Projekts. Wie man dahin kommt, steht
beim [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel): deren Anleitung
deckt die einzelnen Generationen ab und die bleiben bei Firmware-Updates dran. Der Weg, der auf
dem Testgerät hier benutzt wurde — SlopBro plus Firmware-Gate — steht in
[docs/ROOTING.md](docs/ROOTING.md) und ist ausdrücklich ohne Support.

## Umfang

- Listenansicht und Leiste unten, Hintergrund Foto/Hell/Dunkel, 15 Wandbilder mit Rotation
- Typografie, Fokus- und Materialstile, Uhr in 24 h oder 12 h, Oberfläche auf Deutsch und Englisch
- Senioren-Modus: größere Beschriftungen (mindestens 125 %) für den, der wirklich schaut
- Eigener App-Katalog: installierte webOS-Apps, HDMI-Eingänge und System-Apps, die Glasshouse
  nicht führt
- Kacheln umbenennen, Icons wählen, umsortieren, entfernen — mit Kontextmenü über die Fernbedienung
- Web-Oberfläche ohne PIN: Token optional, Anfragen vom lokalen Rechner sind immer erlaubt
- Home-Assistant-Werte als Kacheln, MQTT und Update-Sperre über Glasshouse
- Bildschirmschoner, Einrichtungsassistent, Sicherung und Wiederherstellung der Konfiguration

Wo die Firmware-Nummer am Fernseher steht — mit beiden Wegen: [docs/FIRMWARE.de.md](docs/FIRMWARE.de.md).

### Welche Fernseher

| | Geräte | Was zu erwarten ist |
| --- | --- | --- |
| **Getestet** | LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401, Chromium 79, Glasshouse 0.118.0 | Alles, was hier steht |
| **Sehr wahrscheinlich** | andere webOS-6-Geräte (2021) | gleiche Browser-Engine, nicht ausprobiert |
| **Ungetestet** | webOS 7, 9, 10, 11 („webOS 23" bis „webOS 26"), OLED C und G | Keine Ahnung. Dafür sind Tester da |
| **Nicht unterstützt** | Fernseher ohne Root, ohne Homebrew Channel oder ohne Glasshouse | Der Launcher ist eine App, der Hub braucht eine Root-Shell |

## Voraussetzungen

- ein LG-Fernseher mit webOS, **gerootet**. In der Praxis heißt das
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel); wie man rootet, ist
  dessen Anleitung und nicht diese README
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installiert und einmal geöffnet,
  Dashboard auf Port 8080. Es nimmt das IPK an, und der Launcher liest seine App-Liste dort
- ein Rechner im selben Netz. Für den Launcher: eine Shell mit `curl`. Für den Hub zusätzlich
  `ssh`, `scp`, `python3` (Linux, macOS) oder PowerShell mit OpenSSH-Client (Windows)

## Installieren

Zwei Wege, die funktionieren, und die Scripts — die sind experimentell und nicht der Einstieg.

| Weg | Wie | Braucht | Updates |
| --- | --- | --- | --- |
| **Homebrew Channel** | eine Repository-Adresse eintragen, aus dem Channel installieren | gerooteter Fernseher mit Channel | kommen von selbst |
| Von Hand | Glasshouse → Apps → *install from a file* | das IPK | neues IPK wieder installieren |
| Scripts | `tools/install-launcher.sh`, `tools/install-hub.sh` | `curl`, `python3`, SSH | **experimentell** |

Der Launcher ist ein IPK. Der Hub ist optional und braucht SSH: eine Kopie plus Autostart.

### 1. Homebrew Channel

So werden die anderen Launcher in der Szene verteilt, und ab jetzt ist es auch hier der normale
Weg: der Channel liest eine Repository-Datei, und jede spätere Version kommt von dort, ohne dass
du etwas tun musst.

1. Homebrew Channel auf dem Fernseher, *Settings*, *Add repository*
2. diese Adresse eintragen:

```text
https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
```

3. CleanFrame steht dann in der App-Liste des Channels, dort installieren
4. CleanFrame einmal aus der App-Liste starten, damit es sich einrichtet

Die Adresse zeigt auf das jeweils neueste Release, sie muss also nie geändert werden. Wer
festnageln will, was er installiert, nimmt dieselbe Datei aus dem Repo:
[`repo/apps.json`](repo/apps.json)
(`raw.githubusercontent.com/TheLord83/CleanFrame-webos/main/repo/apps.json`). Beide schreibt
`tools/make-apps-json.py` aus dem gebauten IPK — Hash, Größe, Manifest, Download-URL.

### 2. Von Hand, fünf Minuten

Sinnvoll, solange der Channel noch nicht installiert ist (er installiert seine eigenen Pakete),
oder wenn du genau sehen willst, welche Datei auf den Fernseher geht.

1. das IPK aus dem [aktuellen Release](https://github.com/TheLord83/CleanFrame-webos/releases/latest)
   holen, oder selbst bauen: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`
2. Glasshouse → **Apps** → *install from a file* → IPK wählen → Versionsabfrage bestätigen
3. CleanFrame einmal aus der App-Liste starten

### Der Hub — optional, braucht eine Root-Shell

Der Hub ist für die, die die Einstellungsseite im Browser wollen (dort wohnen die
Home-Assistant-Werte, MQTT und die Fernbedienung). Er ist ein node-Prozess und braucht root:

```sh
scp -r web root@<tv-ip>:/var/lib/cleanframe
ssh root@<tv-ip> 'chmod +x /var/lib/cleanframe/cleanframectl && /var/lib/cleanframe/cleanframectl restart'
```

Danach `http://<tv-ip>:8484/` öffnen. Einzelheiten samt Autostart-Hook:
[docs/INSTALL.md](docs/INSTALL.md).

### 3. Die Scripts — experimentell, und deshalb hier unten

Es sind drei: `install-launcher.sh` (IPK über Glasshouse, kein SSH), `install-hub.sh` (der Hub
per SSH) und `install.sh` (beides, rootet nie). Sie sind geschrieben, sie laufen, und sie sind
auf genau **einem** Fernseher benutzt worden — dem 43NANO779PA aus dieser README. Kein zweites
Modell, keine zweite webOS-Version, kein Windows-Rechner, kein macOS.

Also: nimm den Weg oben, außer du willst sie debuggen. Sie suchen den Fernseher im Netz, bauen
das IPK, laden es hoch und prüfen das Ergebnis — bequem, aber jeder dieser Schritte ist eine
Annahme in deinem Netz, nicht in meinem.

```sh
./tools/install-launcher.sh --tv <tv-ip>     # die App, kein SSH
./tools/install-hub.sh --tv <tv-ip>          # die Einstellungsseite, SSH als root
./tools/install.sh --tv <tv-ip>              # beides
./tools/install.sh --info                    # Modell, webOS, node, Root-Zustand
```

Sie halten an, statt zu raten: kein Glasshouse heißt kein Installieren, eine Sitzung ohne root
heißt kein Hub. `--dry-run` zeigt den Plan, `--lang de` antwortet deutsch, `--help` den Rest.

## Bauen und prüfen

```sh
python3 tools/build-ipk.py app ipk/cleanframe_all.ipk   # IPK
tools/check-all.sh                                      # alle Prüfungen, ohne Fernseher
tools/make-port-patch.sh                                # docs/PORT-CHANGES.patch neu erzeugen
```

`tools/check-all.sh` startet selbst einen Konfigurations-Server und ein kopfloses Chrome und
fährt Syntax, node-8-Verträglichkeit, Icons, API, Tastendrücke und die Live-Übernahme in einem
Lauf. Einzelheiten in [docs/TESTS.md](docs/TESTS.md). Dasselbe Skript läuft in der CI bei jedem Push.

## Dokumentation

- [docs/INSTALL.md](docs/INSTALL.md) — vom Seriengeraet zur laufenden Startseite (englisch)
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — Symptom, Ursache, Kommando (englisch)
- [docs/WEB.md](docs/WEB.md) — Hub: API-Endpunkte, Konfigurationsschema, Betrieb des Dienstes
- [docs/TESTS.md](docs/TESTS.md) — was geprüft wird und wie
- [docs/ICONS.md](docs/ICONS.md) — Icon-Bibliothek und ihre Quellen
- [docs/PORT-CHANGES.patch](docs/PORT-CHANGES.patch) — der vollständige Unterschied zum Original

## Was anders ist als beim Original

`app/device.js` ist neu, `app/main.js` hat ein überschaubares Delta (webOS-App-IDs,
LG-Beschriftungen, Fernbedienung, Prüfschnittstelle), `app/style.css` enthält
Chromium-79-Verträglichkeit, `app/i18n.js` und `app/appinfo.json` sind neu, `app/config.xml`
(Tizen-Verpackung) entfällt. Alles unter `app/assets/` ist byte-identisch zum Original.

## Getestet auf

* LG 43NANO779PA (NanoCell 2021), webOS 6.5.0-2401 (`kisscurl-koli`), Chromium 79, gerootet
* Glasshouse 0.118.0 als Anbindung
* Installation über den Glasshouse-Sideload-Weg, App-ID `com.blackpearl.cleanframe`

Keine Zusage für andere Modelle. Root und fremde IPKs können Garantie- und DRM-Funktionen
beeinflussen; das Installieren erfolgt auf eigenes Risiko.

## Probleme und Fragen

Für alles, was kein Sicherheitsproblem ist, ein [Issue](https://github.com/TheLord83/CleanFrame-webos/issues)
aufmachen oder an **193955790+TheLord83@users.noreply.github.com** schreiben. Eine Meldung ist zehnmal so viel wert mit
Modell, webOS-Version und einem Foto vom Bildschirm.

## Lizenz und Grenzen

* Eigener Code (webOS-Anbindung, Verpackung, Bau-Skripte): MIT — siehe [LICENSE](LICENSE),
  dort stehen beide Copyright-Zeilen (Original und Portierung).
* Oberfläche und Assets stammen aus CleanFrame: MIT für den Code, getrennte Bedingungen für
  Schriften (OFL), Icons (CC0/MIT) und Fotos (Unsplash License) — alles in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), Foto-Quellen in
  [docs/wallpaper-SOURCES.json](docs/wallpaper-SOURCES.json).
* Marken wie Netflix, YouTube oder Disney+ gehören ihren Inhabern. Dieses Projekt behauptet
  keine Zugehörigkeit oder Unterstützung.

English: [README.md](README.md)
