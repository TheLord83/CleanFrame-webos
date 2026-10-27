# msg.sh — the messages of the install scripts, in English and German.
#
# Sourced by tools/install-launcher.sh, tools/install-hub.sh and tools/install.sh.
# One place for the words, so the three scripts cannot drift apart in tone.
# German is the second language (`--lang de`), English is the default.
#
# Use: msg <key> [printf-args...]

CF_LANG="${CF_LANG:-en}"

msg() {
  _key="$1"
  shift
  _lang="$CF_LANG"
  case "${_lang}:${_key}" in
    de:find)            _f='Suche den Fernseher im Netz ...' ;;
    *:find)             _f='Looking for the TV on the network ...' ;;
    de:found)           _f='Fernseher: %s' ;;
    *:found)            _f='TV: %s' ;;
    de:find_none)       _f='Kein Fernseher gefunden, der auf Port 8080 antwortet. Adresse angeben: --tv <ip>, und Glasshouse muss laufen.' ;;
    *:find_none)        _f='No TV answering on port 8080. Pass the address: --tv <ip>. Glasshouse has to be running.' ;;
    de:no_glass)        _f='Auf %s antwortet kein Glasshouse. Ohne Glasshouse laesst sich die App nicht installieren - installiere es zuerst (siehe README, "What you need").' ;;
    *:no_glass)         _f='No Glasshouse on %s. The app cannot be installed without it - install it first (see README, "What you need").' ;;
    de:glass_ok)        _f='Glasshouse antwortet (%s:8080)' ;;
    *:glass_ok)         _f='Glasshouse answers (%s:8080)' ;;
    de:ipk_build)       _f='Baue das IPK aus app/ ...' ;;
    *:ipk_build)        _f='Building the IPK from app/ ...' ;;
    de:ipk_none)        _f='Kein IPK: --ipk <datei> angeben, oder ein Release-IPK herunterladen. Bauen braucht python3.' ;;
    *:ipk_none)         _f='No IPK: pass --ipk <file>, or download a release IPK. Building needs python3.' ;;
    de:no_python)       _f='python3 fehlt. Entweder python3 installieren oder das IPK von Hand ueber Glasshouse installieren (Apps, install from a file).' ;;
    *:no_python)        _f='python3 is missing. Install python3, or install the IPK by hand in Glasshouse (Apps, install from a file).' ;;
    de:plan)            _f='Plan: %s auf %s installieren' ;;
    *:plan)             _f='Plan: install %s on %s' ;;
    de:plan_build)      _f='Plan: IPK aus app/ bauen, dann auf %s installieren' ;;
    *:plan_build)       _f='Plan: build the IPK from app/, then install it on %s' ;;
    de:ask)             _f='Weiter? [J/n] ' ;;
    *:ask)              _f='Continue? [Y/n] ' ;;
    de:aborted)         _f='Abgebrochen.' ;;
    *:aborted)          _f='Aborted.' ;;
    de:dry)             _f='Probelauf: nichts geaendert.' ;;
    *:dry)              _f='Dry run: nothing changed.' ;;
    de:install)         _f='Installiere %s' ;;
    *:install)          _f='Installing %s' ;;
    de:installed)       _f='Installiert: %s %s' ;;
    *:installed)        _f='Installed: %s %s' ;;
    de:verify_fail)     _f='Das IPK wurde gemeldet, aber %s steht nicht in der App-Liste von Glasshouse.' ;;
    *:verify_fail)      _f='The IPK reported success, but %s is not in Glasshouse''s app list.' ;;
    de:launched)        _f='Gestartet. Die Startseite sollte jetzt auf dem Fernseher stehen.' ;;
    *:launched)         _f='Started. The start page should be on the TV now.' ;;
    de:launch_fail)     _f='Installiert, aber das Starten hat nicht geklappt. Oeffne CleanFrame in der App-Liste.' ;;
    *:launch_fail)      _f='Installed, but starting it did not work. Open CleanFrame from the app list.' ;;
    de:hub_note)        _f='Tipp: die Einstellungen (Werte auf der Startseite, Home Assistant) brauchen den Hub: ./tools/install-hub.sh %s' ;;
    *:hub_note)         _f='Next: the settings (values on the start page, Home Assistant) need the hub: ./tools/install-hub.sh %s' ;;
    de:ssh_fail)        _f='Kein SSH auf %s. Der Hub braucht eine gerootete Glotze mit SSH - siehe docs/ROOTING.md.' ;;
    *:ssh_fail)         _f='No SSH on %s. The hub needs a rooted TV with SSH - see docs/ROOTING.md.' ;;
    de:not_root)        _f='SSH antwortet, aber die Sitzung ist nicht root (uid=%s). Der Hub schreibt nach /var/lib und braucht root. Rooten ist nicht Teil dieses Skripts: siehe docs/ROOTING.md, oder installiere nur den Launcher mit ./tools/install-launcher.sh.' ;;
    *:not_root)         _f='SSH answers, but the session is not root (uid=%s). The hub writes to /var/lib and needs root. Rooting is not part of this script: see docs/ROOTING.md, or install only the launcher with ./tools/install-launcher.sh.' ;;
    de:rooted)          _f='SSH als root, uid=%s' ;;
    *:rooted)           _f='SSH as root, uid=%s' ;;
    de:no_node)         _f='Auf dem Fernseher fehlt ein brauchbares node (gefunden: %s, gebraucht: >= 8).' ;;
    *:no_node)          _f='The TV has no usable node (found: %s, need >= 8).' ;;
    de:node_ok)         _f='node %s auf dem Fernseher' ;;
    *:node_ok)          _f='node %s on the TV' ;;
    de:copy)            _f='Kopiere den Hub nach /var/lib/cleanframe ...' ;;
    *:copy)             _f='Copying the hub to /var/lib/cleanframe ...' ;;
    de:autostart)       _f='Autostart einrichten ...' ;;
    *:autostart)        _f='Setting up the autostart ...' ;;
    de:start)           _f='Dienst starten ...' ;;
    *:start)            _f='Starting the service ...' ;;
    de:health_fail)     _f='Der Hub antwortet nicht auf Port 8484. Log: ssh root@%s "tail -30 /var/lib/cleanframe/hub.log"' ;;
    *:health_fail)      _f='The hub does not answer on port 8484. Log: ssh root@%s "tail -30 /var/lib/cleanframe/hub.log"' ;;
    de:hub_ready)       _f='Hub laeuft: http://%s:8484/   (API: /api/health, /api/config, /api/apps)' ;;
    *:hub_ready)        _f='Hub is running: http://%s:8484/   (API: /api/health, /api/config, /api/apps)' ;;
    de:removal)         _f='Entfernen: ./tools/uninstall-web.sh %s (der Launcher bleibt).' ;;
    *:removal)          _f='Removal: ./tools/uninstall-web.sh %s (the launcher stays).' ;;
    de:hub_skipped)     _f='Hub uebersprungen: er braucht root, der Launcher nicht. Spaeter: ./tools/install-hub.sh %s' ;;
    *:hub_skipped)      _f='Hub skipped: it needs root, the launcher does not. Later: ./tools/install-hub.sh %s' ;;
    de:info)            _f='Zustand des Fernsehers' ;;
    *:info)             _f='State of the TV' ;;
    *)                  _f="[${_key}]" ;;
  esac
  # shellcheck disable=SC2059
  printf "$_f\n" "$@"
}
