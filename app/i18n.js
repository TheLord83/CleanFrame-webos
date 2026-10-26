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
