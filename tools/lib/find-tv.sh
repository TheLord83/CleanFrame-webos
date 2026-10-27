# find-tv.sh — find a TV that is running Glasshouse, without being told its address.
#
# Sourced by install-launcher.sh, install-hub.sh and install.sh. Neighbours from the
# ARP table first, because that is one packet, then a sweep of the local /24 with
# parallel curls. A TV in standby answers neither; that is not a bug, it is standby.

# Glasshouse auf einem Fernseher braucht manchmal ueber zwei Sekunden, wenn die
# Kiste gerade zeichnet. Deshalb zweimal fragen, bevor "kein Glasshouse" kommt:
# ein Fehlalarm hier ist der Unterschied zwischen Installieren und Aufgeben.
answers() {
  tries=0
  while [ "$tries" -lt 2 ]; do
    code="$(curl -sS -m 4 -o /dev/null -w '%{http_code}' "http://$1:8080/api/apps" 2>/dev/null)"
    [ "$code" = "200" ] && return 0
    tries=$((tries + 1))
    sleep 1
  done
  return 1
}

find_tv() {
  for host in $(ip neigh show 2>/dev/null | awk '$1 ~ /^[0-9]+\./ {print $1}'); do
    answers "$host" && { printf '%s' "$host"; return 0; }
  done
  prefix=""
  if command -v ip >/dev/null 2>&1; then
    prefix="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | head -1 | sed 's|\.[0-9]*/.*|.|')"
  fi
  if [ -z "$prefix" ] && command -v ifconfig >/dev/null 2>&1; then
    prefix="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}' | head -1 | sed 's|\.[0-9]*$|.|')"
  fi
  [ -n "$prefix" ] || return 1
  hit="$(seq 1 254 | xargs -P 48 -I{} sh -c \
    "curl -sS -m 1 -o /dev/null -w '%{http_code} ${prefix}{}\n' 'http://${prefix}{}:8080/api/apps' 2>/dev/null" \
    | awk '$1 == "200" {print $2; exit}')"
  [ -n "${hit:-}" ] || return 1
  printf '%s' "$hit"
}
