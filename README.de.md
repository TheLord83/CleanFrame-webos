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

![CleanFrame Hub: Darstellung mit der Wandbild-Bibliothek](docs/img/hub.jpg)

*Der Hub im Browser: jede Einstellung der App, gespeichert beim Ändern — dazu ein Live-Bild
des Fernsehers und eine Fernbedienung für die Fälle, in denen der Weg zum Sofa zu weit ist.*

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

Drei Wege zum Launcher, und danach ein optionaler Teil. Nur der Hub braucht SSH.

| Weg | Befehl | Braucht | Updates |
| --- | --- | --- | --- |
| Von Hand | Glasshouse → Apps → *install from a file* | das IPK | neues IPK wieder installieren |
| Launcher-Script | `./tools/install-launcher.sh --tv <ip>` | `curl`, `python3` | erneut laufen lassen |
| Homebrew Channel | die Repository-Datei aus einem Release | — | erledigt der Channel |
| Hub (optional) | `./tools/install-hub.sh --tv <ip>` | SSH als root | erneut laufen lassen |

Der Homebrew-Channel-Weg ist der, über den die anderen webOS-Launcher verteilt werden, und der,
den dieses Projekt nimmt, sobald es ein öffentliches Release gibt. Bis dahin: von Hand oder per
Script.

### 1. Vom Rechner: Linux und macOS

Für den Launcher ist kein SSH nötig — das Script spricht mit Glasshouse auf Port 8080:

```sh
./tools/install-launcher.sh                 # findet den Fernseher, baut das IPK, installiert
./tools/install-launcher.sh --tv 192.168.1.50
./tools/install-launcher.sh --ipk cleanframe_all.ipk   # ein Release-IPK statt selbst bauen
./tools/install-launcher.sh --dry-run       # nur suchen und den Plan zeigen
./tools/install-launcher.sh --lang de       # deutsch

./tools/install-hub.sh --tv 192.168.1.50    # optional: die Einstellungsseite, braucht root
./tools/install.sh --tv 192.168.1.50        # beides in einem Lauf
```

Echte Ausgabe eines Launcher-Laufs:

```text
$ ./tools/install-launcher.sh --tv 192.168.1.50
TV: 192.168.1.50
Glasshouse answers (192.168.1.50:8080)
Building the IPK from app/ ...
Installing com.blackpearl.cleanframe
   package cleanframe_all.ipk for com.blackpearl.cleanframe
   uploading 15802724 bytes
   confirming com.blackpearl.cleanframe 0.5.0
   installed: com.blackpearl.cleanframe 0.5.0 (16770618 bytes)
Installed: com.blackpearl.cleanframe 0.5.0
Started. The start page should be on the TV now.
Next: the settings (values on the start page, Home Assistant) need the hub:
./tools/install-hub.sh 192.168.1.50
```

Und der Hub, der SSH braucht:

```text
$ ./tools/install-hub.sh --tv 192.168.1.50
TV: 192.168.1.50
SSH as root, uid=0
node 8.12.0 on the TV
Copying the hub to /var/lib/cleanframe ...
Setting up the autostart ...
Starting the service ...
Hub is running: http://192.168.1.50:8484/   (API: /api/health, /api/config, /api/apps)
```

Die Meldungen der Scripts sind englisch; mit `--lang de` antworten sie deutsch.

### 2. Vom Rechner: Windows (PowerShell)

`tools/install.ps1` macht dasselbe in denselben Stufen; die Schalter unterscheiden sich nur in der
Schreibweise (`-Tv` statt `--tv`). Es braucht den OpenSSH-Client (Windows-Feature) und Python 3 im
`PATH` für die Netzweite Suche.

```powershell
.\tools\install.ps1 -Tv 192.168.1.50
.\tools\install.ps1 -Tv 192.168.1.50 -LauncherOnly
.\tools\install.ps1 -Tv 192.168.1.50 -DryRun -Lang de
```

### 3. Von Hand, ohne Script

1. IPK holen: `python3 tools/build-ipk.py app dist/cleanframe_all.ipk`, oder die Datei aus einem Release
2. auf den Fernseher bringen: Glasshouse, Apps, *install from a file*
3. CleanFrame einmal aus der App-Liste starten, damit es sich einrichtet
4. der Hub ist optional und braucht eine Root-Shell: `./tools/install-hub.sh --tv <ip>`

### 4. Homebrew-Channel-Repository

Noch nicht. Dieser Weg braucht ein öffentliches Release: die anderen Launcher in der Szene
liefern eine Repository-Datei mit, der Homebrew Channel liest sie unter *Settings*, *Add
repository*, und die Updates kommen von dort.

Die Datei selbst ist keine Arbeit, `tools/make-apps-json.py` schreibt sie aus einem gebauten IPK
(Hash, Größe, Manifest, Download-URL):

```sh
python3 tools/build-ipk.py app dist/cleanframe_all.ipk
python3 tools/make-apps-json.py --ipk dist/cleanframe_all.ipk --tag v0.5.0
```

Was fehlt, ist das Release, auf das sie zeigt. Bis dahin kommt das IPK aus einem eigenen Build
oder von dem, der es dir gegeben hat.

### Was die Scripts tun, und warum die Adresse optional ist

Das Launcher-Script sucht im Netz, wenn keine Adresse angegeben ist: erst die ARP-Tabelle, dann
ein Durchlauf über das lokale /24 nach einem Host, der auf Glasshouse' `/api/apps` antwortet. Das
Hub-Script macht dasselbe und belegt vorher, dass SSH als root antwortet, bevor es etwas kopiert.

Beide halten an, statt zu raten: kein Glasshouse heißt kein Installieren, eine Sitzung ohne root
heißt kein Hub.

`tools/install.sh` ist der Mantel um beide Teile: er installiert den Hub nur, wenn der Fernseher
gerootet ist, und rootet selbst nie. `--dry-run` zeigt den Plan, `--info` meldet Modell, webOS,
node und Root-Zustand, `--launcher-only` fasst nichts außer dem IPK an.

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
