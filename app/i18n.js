/* CleanFrame webOS — bilingual support (German/English).
 *
 * Call in code:    T('Settings')            -> text in the current language
 *                  T('Add app')             -> fallback to the English key
 *                  T('Remove', {name: 'x'}) -> replace the {name} placeholder
 *
 * Language: localStorage 'cleanframe.lang' ('de' or 'en'), otherwise the system
 * language (navigator.language), otherwise English. The English texts are the
 * keys, so missing translations never show up as empty text.
 */
(function () {
  'use strict';

  var DICT = {
    de: {
      /* Einstellungen auf dem Fernseher: Textgroesse und Wetterzeile */
      /* HDMI-Eingänge (External Input Manager): Liste, Zustände, Umschalten */
      'Inputs': 'Eingänge',
      'HDMI sources': 'HDMI-Quellen',
      'Looking for inputs ...': 'Suche Eingänge ...',
      'Try again': 'Nochmal versuchen',
      'No HDMI inputs were reported by this TV.': 'Dieser Fernseher hat keine HDMI-Eingänge gemeldet.',
      'Active': 'Aktiv',
      'Connected': 'Verbunden',
      'No device': 'Kein Gerät',
      'Text size': 'Schriftgröße',
      'Weather': 'Wetter',
      'Shown as': 'Anzeige',
      'Place': 'Ort',
      'Choose a place for the weather line.': 'Wähle einen Ort für die Wetterzeile.',
      'Known places': 'Bekannte Orte',
      'A new place is added in the hub in the browser.': 'Ein neuer Ort kommt im Hub im Browser dazu.',
      'No place set yet.': 'Noch kein Ort gesetzt.',
      'Search in the hub': 'Im Hub suchen',
      'Left and right move the cursor, OK looks the name up in the hub.':
        'Links und rechts setzen den Cursor, OK sucht den Namen im Hub.',
      'Choose a place from the list or type a name.': 'Wähle einen Ort aus der Liste oder tippe einen Namen.',
      'Set the place first. Until then the weather stays off.':
        'Setze zuerst den Ort. Bis dahin bleibt das Wetter aus.',
      'Set the place first, then the weather can show.':
        'Setze zuerst den Ort, dann kann das Wetter angezeigt werden.',
      'Town or region': 'Ort oder Region',
      'Not set': 'Nicht gesetzt',
      'Looking up the place ...': 'Ort wird gesucht ...',
      'Place saved: ': 'Ort gespeichert: ',
      'The place could not be saved.': 'Der Ort konnte nicht gespeichert werden.',
      'Where it sits': 'Wo sie steht',
      'Size': 'Größe',
      'Distance from the clock': 'Abstand zur Uhr',
      'Small': 'Klein',
      'Normal': 'Normal',
      'Large': 'Groß',
      'Close': 'Nah',
      'Wide': 'Weit',
      'Very wide': 'Sehr weit',
      'Symbol and temperature': 'Symbol und Temperatur',
      'Symbol only': 'Nur Symbol',
      'Symbol, temperature and word': 'Symbol, Temperatur und Wort',
      'Text only': 'Nur Text',
      'Before the clock': 'Vor der Uhr',
      'Next to the clock': 'Neben der Uhr',
      'Under the clock': 'Unter der Uhr',
      'Right edge': 'Rechter Rand',
      'Senior mode': 'Senioren-Modus',
      'No place': 'Kein Ort',
      'Clock and language': 'Uhr und Sprache',
      'Clock': 'Uhr',
      'Senior mode keeps the text at 125 % or more.': 'Der Senioren-Modus hält die Schrift bei mindestens 125 %.',
      /* Home Assistant states: the value text on the status strip. The English
         word is the key (see the header), so only German needs an entry. */
      'On': 'An',
      'Off': 'Aus',
      'Open': 'Offen',
      'Closed': 'Geschlossen',
      'Not available': 'Nicht verfügbar',
      'Unknown': 'Unbekannt',
      'Home': 'Zuhause',
      'Away': 'Abwesend',
      'Day': 'Tagsüber',
      'Night': 'Nachts',
      'Heating': 'Heizt',
      'Cooling': 'Kühlt',
      'Idle': 'Bereit',
      'Playing': 'Läuft',
      'Paused': 'Pausiert',
      'Docked': 'In Station',
      'Locked': 'Verriegelt',
      'Unlocked': 'Offen',

      /* Values on the start page (TV-side settings) */
      'Values on the start page': 'Werte auf der Startseite',
      'nothing chosen in the hub': 'nichts im Hub ausgewählt',
      'Chosen in the hub. Left switches the value on or off, right renames it.': 'Im Hub ausgewählt. Links schaltet den Wert an oder aus, rechts benennt ihn um.',
      'Nothing chosen in the hub yet.': 'Im Hub ist noch nichts ausgewählt.',
      'Switch on or off, or rename': 'An/aus schalten oder umbenennen',
      'In the strip: ': 'In der Leiste: ',
      'Hidden: ': 'Versteckt: ',
      'Renamed: ': 'Umbenannt: ',
      'Hide ': 'Verbergen: ',
      'Show ': 'Anzeigen: ',

      /* Header */
      'Screensaver': 'Bildschirmschoner',
      'All apps': 'Alle Apps',
      'Settings': 'Einstellungen',
      'Home controls': 'Startseiten-Bedienung',

      /* Settings: overview */
      'Background': 'Hintergrund',
      'Layout': 'Anordnung',
      'Typography': 'Schrift',
      'Focus': 'Fokus',
      'Apps on Home': 'Apps auf der Startseite',
      'Home and TV settings': 'Startseite und TV',
      'App display': 'App-Darstellung',
      'Arrange': 'Anordnen',
      'TV settings': 'TV-Einstellungen',
      'LG Home': 'LG Startseite',
      /* Back auf der Startseite und Icon-Auswahl (0.5.9) */
      'Recent apps': 'Zuletzt geöffnet',
      'Open. Back closes the list.': 'OK öffnet. Zurück schließt die Liste.',
      'The five apps you opened last.': 'Die fünf Apps, die zuletzt offen waren.',
      'Nothing opened yet.': 'Noch nichts geöffnet.',
      'Icon': 'Symbol',
      'Choose. Up reaches the groups.': 'OK wählt. Nach oben zu den Gruppen.',
      'Same catalog as in the hub.': 'Derselbe Katalog wie im Hub.',
      'No icons bundled.': 'Keine Symbole im Paket.',
      'Own icon': 'Eigenes Symbol',
      'Letters': 'Buchstaben',
      /* Fehlermeldungen und Zustaende im Wallpaper-Dialog (0.5.9) */
      'Applied': 'Aktiv',
      'Preview': 'Vorschau',
      'Loading ': 'Lade ',
      'Applying ': 'Wende an: ',
      'Couldn’t load ': 'Konnte nicht laden: ',
      'Couldn’t load this appearance.': 'Dieses Aussehen liess sich nicht laden.',
      'Your current choice is kept.': 'Die bisherige Wahl bleibt.',
      'Open the LG Home screen': 'Die Startseite von LG öffnen',
      'Picture, sound and network settings': 'Bild-, Ton- und Netzwerkeinstellungen',

      /* Background */
      'Background type': 'Hintergrundart',
      'Wallpaper': 'Hintergrundbild',
      'Rotation': 'Wechsel',
      'Photo': 'Foto',
      'Light': 'Hell',
      'Dark': 'Dunkel',
      'Fixed': 'Fest',
      'Every hour': 'Jede Stunde',
      'Each time Home opens': 'Bei jedem Öffnen',
      'Apply selected photo': 'Gewähltes Foto übernehmen',
      'Clear tint': 'Tönung entfernen',
      'Choose Photo to use wallpaper and rotation.': 'Für Hintergrundbild und Wechsel zuerst „Foto" wählen.',
      'Choose Photo in Background to use rotation.': 'Für den Wechsel zuerst „Foto" als Hintergrundart wählen.',

      /* Layout */
      'Dock': 'Leiste',
      'List': 'Liste',
      'Icons': 'Nur Symbole',
      'Text': 'Nur Text',
      'Icons and text': 'Symbole und Text',
      'Both': 'Beides',

      /* Type and focus */
      'Font': 'Schriftart',
      'Choose Glass focus or the Dock layout to use materials.': 'Materialien gibt es mit Fokus „Glas" oder der Leiste.',
      'Glass': 'Glas',
      'Frost': 'Frost',
      'Soft': 'Weich',
      'Material': 'Material',
      'Focus style': 'Fokus-Stil',

      /* App browser and editor */
      'Loading installed apps…': 'Installierte Apps werden geladen …',
      'No installed apps found.': 'Keine installierten Apps gefunden.',
      'Other installed apps': 'Weitere installierte Apps',
      'Recently removed': 'Zuletzt entfernt',
      'Remove from Home': 'Von der Startseite entfernen',
      'Add app': 'App hinzufügen',
      'Home is full': 'Startseite ist voll',
      'Home needs one app': 'Mindestens eine App muss bleiben',
      'Home holds nine apps. Remove one first.': 'Die Startseite fasst neun Apps. Erst eine entfernen.',
      'Could not read installed apps.': 'Installierte Apps konnten nicht gelesen werden.',
      'Undo': 'Rückgängig',
      'Undone: ': 'Rückgängig gemacht: ',
      'Add ': 'Hinzufügen: ',
      'Move ': 'Verschieben: ',
      'Remove ': 'Entfernen: ',
      'Moving ': 'Verschiebe ',
      'moved to position ': 'verschoben auf Position ',
      'is on Home, position ': 'ist auf der Startseite, Position ',
      ' stays installed.': ' bleibt installiert.',
      ' is in Recently removed. OK puts it back.': ' ist unter „Zuletzt entfernt". OK holt die App zurück.',
      ' from Home': ' von der Startseite',
      ' to Home': ' zur Startseite',
      'Nothing to undo': 'Nichts rückgängig zu machen',
      'Not saved. OK tries again.': 'Nicht gespeichert. OK versucht es erneut.',
      'Couldn’t save this change.': 'Änderung ließ sich nicht speichern.',
      'Couldn’t save. Nothing changed.': 'Nicht gespeichert, nichts geändert.',

      /* Dialogs */
      'Leave Home?': 'Startseite verlassen?',
      'Setup on your phone': 'Einrichtung am Handy',
      'Scan the code with your phone. The setup runs in the browser and opens right away.':
        'Scanne den Code mit dem Handy. Die Einrichtung läuft im Browser und öffnet sich sofort.',
      'The television stays as it is.': 'Der Fernseher bleibt, wie er ist.',
      'The television has no address in the network yet.': 'Der Fernseher hat noch keine Adresse im Netz.',
      /* Tempo-Seite (Roadmap #12) */
      'Speed': 'Tempo',
      'Frame time': 'Bildzeit',
      'Key delay': 'Tastenverzögerung',
      'Since start': 'Seit dem Start',
      'not measured yet': 'noch nicht gemessen',
      'Two seconds of frames, median and 95th percentile. Until paint, so a lower bound.':
        'Zwei Sekunden Bilder, Median und 95-Prozent-Wert. Bis zum Malen gemessen, also eine Untergrenze.',
      'From the key press to the next frame. Press OK, then use the remote.':
        'Vom Tastendruck bis zum nächsten Bild. OK drücken, dann die Fernbedienung benutzen.',
      'Time since the app started, measured once at the first picture.':
        'Zeit seit dem Start der App, einmal beim ersten Bild gemessen.',
      'Press a few keys now.': 'Jetzt ein paar Tasten drücken.',
      'Open LG Home?': 'LG Startseite öffnen?',
      'Stay': 'Bleiben',
      'Back': 'Zurück',
      'Done': 'Fertig',
      'Retry this photo': 'Foto erneut versuchen',
      'Return to Background': 'Zurück zum Hintergrund',
      'Preparing ': 'Wird vorbereitet: ',
      'Try again': 'Erneut versuchen',
      'The TV could not open this screen.': 'Der Fernseher konnte diesen Bildschirm nicht öffnen.',
      'Saved: ': 'Gespeichert: ',
      'Not saved: ': 'Nicht gespeichert: ',
      'Last app': 'Letzte App',
      'Add to Home': 'Auf die Startseite',
      'Language': 'Sprache',
      'Run setup again': 'Einrichtung erneut starten',
      'Language, home screen, display': 'Sprache, Startseite, Darstellung',
      'Setup': 'Einrichtung',
      'Snapshot': 'Screenshot',
      'Refresh': 'Aktualisieren',
      'Like the TV': 'Wie der Fernseher',
      'Rename': 'Umbenennen',
      'Save': 'Speichern',
      'Remove from Home': 'Von der Startseite nehmen',
      'Cancel': 'Abbrechen',
      'Options': 'Optionen',
      'Return to ': 'Zurück zu ',
      'Retry this change': 'Änderung erneut versuchen',
      'Apply selected setting': 'Gewählte Einstellung übernehmen',
      'Choose a wallpaper': 'Hintergrundbild wählen',
      'Choose a rotation interval': 'Wechsel-Intervall wählen',
      'Open on the TV': 'Am Fernseher öffnen',
      /* Mit dem Fernseher starten (webOS-Activity) */
      /* Sicherung auf Stick (#16) */
      'Backup to a stick': 'Sicherung auf Stick',
      'No stick': 'Kein Stick',
      'Ready': 'Bereit',
      'Stick': 'Stick',
      'No stick found': 'Kein Stick gefunden',
      'Plug in a stick formatted as FAT32 or exFAT.': 'Steck einen Stick an, der als FAT32 oder exFAT formatiert ist.',
      'Save to stick': 'Jetzt sichern',
      'Saved': 'Gesichert',
      'Restore from stick': 'Von diesem Stick zurückspielen',
      'Restore': 'Zurückspielen',
      'Nothing to restore': 'Nichts zum Zurückspielen',
      'Reading ...': 'Wird gelesen …',
      'Saved as {name}': 'Gesichert als {name}',
      'Restored from {name}': 'Zurückgespielt aus {name}',
      'The file was not written.': 'Die Datei wurde nicht geschrieben.',
      'The stick holds a backup without settings.': 'Die Sicherung auf dem Stick enthält keine Einstellungen.',
      'The stick holds a newer version of the settings.': 'Die Sicherung stammt von einer neueren Fassung.',
      'This backup is not from CleanFrame.': 'Diese Sicherung stammt nicht von CleanFrame.',
      'The backup cannot be read.': 'Die Sicherung lässt sich nicht lesen.',
      'The stick cannot be written.': 'Auf den Stick lässt sich nicht schreiben.',
      'More than one stick is plugged in.': 'Es stecken mehrere Sticks.',
      'The backup holds the Home Assistant token and the MQTT password.': 'Die Sicherung enthält Home-Assistant-Token und MQTT-Passwort.',
      'The hub did not answer.': 'Der Hub hat nicht geantwortet.',
      'Start with the TV': 'Mit dem Fernseher starten',
      'After start-up': 'Nach dem Einschalten',
      'When home appears': 'Wenn Home erscheint',
      'At start-up and at home': 'Beim Einschalten und bei Home',
      'At start-up': 'Beim Einschalten',
      'At home': 'Bei Home',
      'Read on the page': 'Auf der Seite lesen',
      'Not available': 'Nicht verfügbar',
      'Reading ...': 'Wird gelesen …',
      'The television did not report its activities.': 'Der Fernseher hat seine Activities nicht gemeldet.',
      'Could not save': 'Konnte nicht speichern',
      'Turn on': 'Einschalten',
      'Turn off': 'Ausschalten',
      'Not on Home': 'Nicht auf der Startseite',
      'On Home': 'Auf der Startseite',
      'Then scroll': 'Dann scrollen',
      'Open selected group': 'OK öffnet die Gruppe',
      'OK places it, Back puts it back.': 'OK legt sie ab, Zurück bricht ab.',
      ' app': ' App',
      ' apps': ' Apps',
      ' of ': ' von ',
      'Restore ': 'Zurückholen: ',
      'Couldn’t save ': 'Nicht gespeichert: ',
      'Wallpaper ': 'Hintergrundbild ',
      'Wallpaper rotation': 'Bildwechsel',
      'Materials are available with a Photo background.': 'Materialien gibt es mit einem Foto-Hintergrund.',
      'Font kept: ': 'Schrift behalten: ',
      'Unavailable font: ': 'Schrift nicht verfügbar: ',
      'your choice': 'deine Auswahl',
    }
  };

  function detect() {
    var saved = null;
    try { saved = localStorage.getItem('cleanframe.lang'); } catch (e) {}
    if (saved === 'de' || saved === 'en') return saved;
    var nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '';
    return /^de/i.test(nav) ? 'de' : 'en';
  }

  var lang = detect();
  var table = DICT[lang] || null;

  function t(key, vars) {
    var text = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.split('{' + name + '}').join(String(vars[name]));
      });
    }
    return text;
  }

  window.CleanFrameI18n = {
    lang: lang,
    /* Test helper: number of entries per language and a sample text. */
    probe: function (key) {
      var de = DICT.de || {}, en = DICT.en || {};
      return { de: Object.keys(de).length, en: Object.keys(en).length, sample: (table && table[key]) || null, hasRename: Object.prototype.hasOwnProperty.call(de, 'Rename') };
    },
    t: t,
    languages: ['de', 'en'],
    set: function (next) {
      if (next !== 'de' && next !== 'en') return;
      try { localStorage.setItem('cleanframe.lang', next); } catch (e) {}
      lang = next;
      table = DICT[lang] || null;
    }
  };
}());
