#!/bin/sh
# Hält das Kopplungsfenster am Fernseher offen, bis der Schlüssel da ist.
# Aufruf: pair-open.sh <tv-ip> [versuche]
# Jeder Versuch öffnet die Frage am Gerät; sobald jemand bestätigt, ist der Schlüssel
# gespeichert und die Schleife endet.
TV="${1:-192.168.1.50}"
TRIES="${2:-14}"
i=1
while [ "$i" -le "$TRIES" ]; do
  STATUS=$(curl -sS -m 10 "http://$TV:8484/api/tv/pair")
  case "$STATUS" in
    *'"paired":true'*) echo "gekoppelt nach Prüfung $i"; exit 0 ;;
  esac
  echo "Versuch $i: Frage am Fernseher offen — jetzt bestätigen"
  ANSWER=$(curl -sS -m 40 -X POST -H 'Content-Type: application/json' \
    --data '{"waitSeconds":30}' "http://$TV:8484/api/tv/pair")
  echo "  -> $ANSWER"
  case "$ANSWER" in
    *'"paired":true'*) echo "gekoppelt"; exit 0 ;;
  esac
  i=$((i + 1))
  sleep 2
done
echo "nicht gekoppelt nach $TRIES Versuchen"
exit 1
