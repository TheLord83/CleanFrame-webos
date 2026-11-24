#!/bin/sh
# disable-service.sh — schaltet Start beim Einschalten und die HOME-Taste wieder ab.
#
# Entfernt nur den Autostart-Link und beendet den Dienst. App und Dienstdateien
# bleiben liegen; ein erneutes enable-service.sh schaltet alles wieder ein.
#
#   tools/disable-service.sh --tv 192.168.0.49
set -e
TV=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tv) TV="$2"; shift 2 ;;
    *) echo "unbekannt: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TV" ] || { echo "Aufruf: $0 --tv <ip>" >&2; exit 2; }

SVC=com.blackpearl.cleanframe.service
SSH="ssh -o StrictHostKeyChecking=no -o LogLevel=ERROR root@$TV"

# pkill-Muster nicht in die Kommandozeile schreiben: das trifft sonst die eigene SSH-Sitzung.
$SSH "rm -f /var/lib/webosbrew/init.d/50-cleanframe-service
printf '#!/bin/sh\nkill \$(cat /tmp/cfsvc.pid 2>/dev/null) 2>/dev/null\nrm -f /tmp/cfsvc.pid\n' > /tmp/cf-stop.sh
sh /tmp/cf-stop.sh
rm -f /tmp/cf-stop.sh
ls /var/lib/webosbrew/init.d/ | grep -c cleanframe-service || true"

echo "Autostart entfernt, Dienst beendet. Die App selbst bleibt installiert."
