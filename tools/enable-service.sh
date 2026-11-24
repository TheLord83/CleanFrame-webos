#!/bin/sh
# enable-service.sh — schaltet Start beim Einschalten und die HOME-Taste ein.
#
# Der Dienst selbst kommt mit dem App-Paket (services/com.blackpearl.cleanframe.service)
# und wird vom Paketmanager registriert. Hier wird nur der Autostart verlinkt und
# der Dienst einmal erhoeht, damit er den App-Manager ansprechen darf.
#
#   tools/enable-service.sh --tv 192.168.0.49
#
# Ausschalten: tools/disable-service.sh --tv 192.168.0.49
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
HB=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service
SSH="ssh -o StrictHostKeyChecking=no -o LogLevel=ERROR root@$TV"

$SSH "test -d /media/developer/apps/usr/palm/services/$SVC" || {
  echo "Der Dienst liegt nicht auf dem Fernseher - erst die App installieren (tools/install-ipk.py)." >&2
  exit 1
}

$SSH "node $HB/elevate-service $SVC >/dev/null 2>&1 || true
ln -sf /media/developer/apps/usr/palm/services/$SVC/autostart.sh /var/lib/webosbrew/init.d/50-cleanframe-service
chmod +x /media/developer/apps/usr/palm/services/$SVC/autostart.sh
ls -l /var/lib/webosbrew/init.d/50-cleanframe-service"

echo "Autostart verlinkt. Wirksam ab dem naechsten Einschalten."
echo "Sofort starten:  ssh root@$TV 'sh /media/developer/apps/usr/palm/services/$SVC/autostart.sh'"
