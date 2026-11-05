# Feature-Liste: inspiriert von den Nachbarn (Stand 04.11.2026)

Grundlage: `docs/ROADMAP.md` + offene Issues (#5, #6, #7, #8, #10, #12) in diesem Repo,
dazu eine Messung der Szene vom 04.11.2026 (GitHub-Suchabfrage `webos launcher`,
40 Repos angesehen, die READMEs und Release-Notizen der relevanten gelesen).

Zwei Regeln dieses Repos gelten weiter: nichts kommt auf die Liste, was in dieser Form
schon existiert, und nichts wird ausgeliefert, ohne dass der rueckweg am Geraet geprueft ist.

## 1. Der grosse Fund: Inputs gibt es beim Upstream nicht mehr „gratis”

Unser Port stammt vom Upstream-Stand **vor** CleanFrame 0.7.0. Der Upstream hat am 02.11.2026
0.7.0 veroeffentlicht; die relevanten Aenderungen seit unserem Stand (Commits vom 27.10. und
02.11.):

- **HDMI-Eingaenge am Geraet** (`Add discovered HDMI inputs with bounded switching and truthful
  errors`, `Refresh HDMI status when returning to the chooser`): eine neue Einstellungsseite
  „Inputs”, die die HDMI-Ports des Fernsehers auflistet, mit `Active`, `Connected` und
  `Disconnected — may be asleep`, Zeitlimit pro Umschaltung, sichtbaren Fehlern und einem
  „Try again”, wenn die Abfrage scheitert.
- Installation ab Tizen 5.0, Kompatibilitaetsberichte pro Modell/Firmware, Start- und
  Recovery-Grenzen getrennt dokumentiert.
- Optionale experimentelle „2020 Frame”-Profilquelle, oeffentliche Pakete ohne SDK-Build-Ausgabe.

**Wichtig fuer uns:** Die UI- und Zustandslogik (Seite, Zustaende, Fehlertexte, Retry) koennen wir
uebernehmen — die Geraeteanbindung **nicht**. Upstream spricht `window.tizen.systeminfo` /
`window.tizen.tvwindow` (`getPropertyValue('VIDEOSOURCE')`, `getSource`, `setSource`). In webOS
macht das der External Input Manager. Der Weg bei Launch Home (MIT, gelesen in `src/js/luna.js`)
ist eine Fallback-Kette, weil keine der APIs auf allen Firmware-Staenden antwortet:

1. `luna://com.webos.service.apiadapter/tv` → `switchInput {inputId}`
2. `luna://com.webos.service.eim` → `getInputStatus {id}` → `applicationManager/launch`
   mit dem `appId` des Eingangs
3. `luna://com.webos.service.utp.extinputs` → `open {inputSourceType: "HDMI", options: {mediaId}}`
   (mit Rueckfall auf `{inputSource: "HDMI_<n>"}`)
4. Liste lesen: `luna://com.webos.service.eim/getAllInputStatus`, als Ersatz per root
   (`hbchannel exec` + `luna-send`) — genau der Fall, den Launch Home fuer „in-app call fails”
   dokumentiert.

Damit wird **unser Issue #8** zu einem Port mit klarer Mechanik statt zu einer offenen Frage.
Unser `app/device.js` kennt heute nur `applicationManager/launch` und `listApps` — `sources`,
`setSource`, `cancelSource` fehlen komplett.

## 2. Aus der Szene: was wirklich neu ist (04.11.2026)

Fuenf Nachbarn mit eigener Mechanik, die wir noch nicht haben. Alle MIT oder Apache, keiner
verlangt, dass wir eine Lizenz uebernehmen, die nicht passt.

| Fund | Wo gesehen | Mechanik | Aufwand | Nutzen |
|---|---|---|---|---|
| **Kaltstart ohne Hooks** | Launch Home (29★, MIT) | eine **webOS-Activity** (`activitymanager/create`) mit Trigger `bootManager/getBootStatus` startet den Launcher; eine zweite mit Trigger `applicationManager/getForegroundAppInfo` oeffnet ihn, wenn LGs Home erscheint. webOS fuehrt sie selbst aus, sie ueberleben Reboots, funktionieren auch ohne Homebrew-Startup-Hooks | klein (zwei `luna-send`-Aufrufe, ein Schalter) | hoch: macht #5 „Replace LG Home” deutlich weniger riskant, weil kein `init.d`-Hook und kein Mount noetig ist, um „nach dem Start da zu sein” |
| **Home-Taste ohne Takeover** | dieselbe Stelle | Home-Taste auf den eigenen Launcher legen per Input Hook; dazu ein 2-s-Halten als Notausstieg zu LG Home und ein 8-s-Halten, das die Abfangung freigibt (LG TV HA Launcher, GPL-3.0 — nur die Idee, nicht der Code) | klein | hoch: der Rueckweg ist der Punkt, an dem #5 bisher scheitert |
| **Geraetezustand an den Eingaengen** | Hearth (324★, MIT) | Eingaenge ohne Geraet ausgegraut, **Name des angeschlossenen Geraets** unter dem Eingang (per `eim`, braucht root) | klein, nach #8 | mittel: „HDMI 2” wird zu „PlayStation” |
| **Zustands-API des Hubs fuer Tests** | Hearth, Homebar, Launch Home | „was steht gerade im Fokus” als JSON (`/api/ui/state`) — wir haben sie schon, aber **ohne** die Einstellungszeilen; sweep-flow ist raus, der Zeilen-Test liest jetzt das DOM | klein | mittel: macht den Zeilen-Test unabhaengig vom Browser-Port |
| **Backup/Restore auf USB** | Launch Home, Homebar | Einstellungen als eine JSON-Datei auf einen USB-Stick, benannt, wieder einlesbar | klein | mittel: nach einem Werksreset ist die Einrichtung in 10 Sekunden wieder da |

**Bewusst nicht uebernommen** (und warum):

- *TMDB-Trending-Reihen, „Continue Watching”, Krypto-Kurse, Wetter-Abo-Dienste* (Free My TV,
  5.848★): brauchen Konten, API-Schluessel und einen Netzwerkabruf, der nicht durch den Hub geht.
  Widerspricht der Linie dieses Repos (nur Open-Meteo, alles ueber den Hub, kein Konto).
- *Live-Hintergrundvideo / Apple-Aerial-Streams* (Luma, Launch Home): Aufloesung, Datenmenge und
  Akku/Netz-Last am Geraet stehen in keinem Verhaeltnis zu dem, was es besser macht.
- *Sprachsteuerung* (Launch Home, „AI Voice”): eigener WebSocket-Dienst, Mikrofon-Freigabe am TV;
  eigenes Vorhaben, nicht ein Feature am Launcher.
- *Native Launcher (Rust/C++, z. B. Luma nativ, lg-vision-launcher)*: steht in `docs/ROADMAP.md`
  unter *Not doing* und bleibt dort — kein gemessenes Problem.

## 2b. Nachtrag 05.11.2026: Internet-TV auf der Startseite (Glasshouse)

Glasshouse hat am 05.11.2026 **Internet-TV auf seiner Startseite** angekuendigt (Beitrag in
r/LGOLED, `u/Nutcasey`): eigene M3U-Playlist oder Xtream-Login, Lieblingssender als **eigene Reihe auf
Home**, stilles **Live-Vorschau-Bild** beim Markieren (neben der Uhr oder im Sender-Kachel selbst), OK
fuer Vollbild, Zurueck zum Weiterblaettern. Dazu ein **Programmführer (EPG)** mit Vorschau, Lineup
sortierbar, Sender umbenennbar, Favoriten vom Telefon oder Rechner pflegbar.

Einordnung fuer uns, ohne es zu bauen:

- **Es ist eine andere Produktklasse, kein Feature am Launcher.** Ein Launcher zeigt Kacheln;
  Internet-TV bringt einen Player, einen Playlist-Import und einen EPG-Dienst mit. Das ist
  dieselbe Grenze, an der wir *Live-Hintergrundvideo* und *Sprachsteuerung* schon abgelehnt haben.
- **Was daran hoechstens nachdenkenswert waere:** Dinge, die man oft braucht, gehoeren auf die
  Startseite und nicht in die Einstellungen. Diese Richtung ist mit der Werkzeugzeile (0.6.56) und
  `#8` schon Realitaet — dafuer braucht es kein Internet-TV.
- **Was wir dafuer NICHT brauchen:** Playlist-Parser, DRM-Fragen, Sender-Logos, EPG-Abgleich.
- **Ehrlich zum Rueckweg:** Ein Player, der auf der Startseite startet, braucht ein sauberes
  Zurueck (Vollbild, Ton, haengende Streams). Solange das am Geraet nicht geprueft ist, kommt es
  nicht auf die Liste.

- **Entscheidung Stefan, 05.11.2026: nicht nachbauen.** Glasshouse' Internet-TV wird nicht
  nachgebaut — weder der Player noch der Programmführer, und auch nicht „nur die Form davon". Was
  am Fernseher fehlt, entscheidet der Betreiber am Gerät und nicht ein Beitrag auf Reddit. Der
  Eintrag bleibt als Beleg stehen, damit die Frage nicht jedes Mal neu aufkommt.

Damit steht davon nichts auf unserer Liste.

## 3. Was auf unsere bestehende Liste gehoert (mit Herkunft)

Reihenfolge nach Nutzen je Aufwand, alles ohne Geraet vorbereitbar, das letzte Stueck braucht es:

1. **#8 Inputs** — jetzt mit Mechanik (Abschnitt 1). Die Seite, die Zustaende und die Fehlertexte
   kommen vom Upstream; die Anbindung ist die Fallback-Kette aus Abschnitt 1.
2. **Kaltstart per Activity + Home-Taste per Input Hook** — der billigere, sichere halbe Weg zu #5.
   Erst danach lohnt der Takeover selbst (Mount), weil dann schon etwas Funktioniert, auf das man
   zurueckfallen kann.
3. **#10 Quiet mode** — Zusammenlegung mit dem Bildschirmschoner vorher klaeren (steht so in der
   Roadmap). Aus der Szene dazu: Dimmen in Stufen/automatisch nach Uhrzeit, OLED-Shift von ein paar
   Pixeln pro Minute, „nach X Minuten Fernseher aus”.
4. **#12 Speed tab** — unveraendert sinnvoll; Luma hat inzwischen eine Update-Pruefung am Geraet,
   das ist eine verwandte, kleinere Stufe (Version + neuestes Release, ohne Download).
5. **#7 App-Liste ohne Glasshouse** — unveraendert; die LS2-Subscription statt Poll steht schon im
   Skill (`references/adoption-roadmap.md`).
6. **#6 Debloat** — eigener Befehl mit `--dry-run`/`--restore`, wie in der Roadmap beschlossen.
7. **Geraetezustand + USB-Backup** — kleine Sachen nach #8, wenn die Eingangsseite steht.

## 4. Riesenzahlen, aber nicht vergleichbar

`Free My TV` (5.848★) und `OmarchyTV` (455★) sind Android-first und bedienen webOS als Nebenweg;
`Luma` (297★, **nativ**) ist der ernsthafte Nachbar, aber in einer anderen Technik. Keiner von
ihnen ist ein Grund, unsere Richtung zu wechseln — die Funktionen daraus stehen oben, der Rest ist
fuer ihre Plattform gebaut.
