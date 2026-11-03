# tvguard.sh — the same lock as tools/lib/tvguard.py, for the shell scripts.
#
# One rule, two languages, one place each: the install scripts source this file
# and call tvguard_require, so "refused" is a line of code that can be changed
# instead of five copies that drift apart.
#
# Use:
#   . "$HERE/lib/tvguard.sh"
#   tvguard_require "$TV" "./tools/install-hub.sh --tv $TV" "$RELEASE_OK"
#
# Exit code 78 (EX_CONFIG) means refused on purpose, nothing was sent. Loopback
# is always allowed; every other address needs --release-ok="<date> <occasion>".

TVGUARD_EXIT_BLOCKED=78
TVGUARD_ACCEPTANCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/docs/ACCEPTANCE.md"

# True only when every address behind the name is loopback (or it is a literal
# loopback IP). A name that does not resolve is refused, not trusted.
tvguard_is_loopback() {
  local host="${1:-}"
  host="${host#[}"; host="${host%]}"
  case "$host" in
    "" ) return 1 ;;
    localhost|localhost.localdomain|ip6-localhost) return 0 ;;
    127.*|::1) return 0 ;;
  esac
  local addrs
  addrs="$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u)"
  [ -n "$addrs" ] || return 1
  local a
  for a in $addrs; do
    case "$a" in
      127.*|::1) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

tvguard_head() {
  if [ -r "$TVGUARD_ACCEPTANCE" ]; then
    # Title and intro only: stop at the first "## " section, drop empty lines.
    awk '/^## /{exit} NF{print "   " $0}' "$TVGUARD_ACCEPTANCE" | head -n 14
  else
    echo "   (docs/ACCEPTANCE.md is missing)"
  fi
}

# tvguard_require <host> <command-line> <release-ok>
tvguard_require() {
  local host="${1:-}" command="${2:-}" release_ok="${3:-}"
  tvguard_is_loopback "$host" && return 0
  if [ -n "$release_ok" ]; then
    echo "   release-ok: $release_ok ($host)"
    return 0
  fi
  {
    echo ""
    echo "REFUSED: this would write to $host."
    echo "The television is locked until it is released for a run. Loopback is always"
    echo "allowed (the bench hub on 127.0.0.1:8484); every other address needs the flag."
    echo ""
    echo "What is being accepted, and how, is written in docs/ACCEPTANCE.md:"
    tvguard_head
    echo ""
    echo "Repeat with the occasion, e.g. --release-ok=\"2026-11-04 acceptance\":"
    echo "   $command --release-ok=\"<date> <occasion>\""
    echo ""
    echo "Exit code $TVGUARD_EXIT_BLOCKED means: refused on purpose, nothing was sent."
  } >&2
  exit "$TVGUARD_EXIT_BLOCKED"
}

# tvguard_warn <host> <tool> — for reading tools: they only warn.
tvguard_warn() {
  local host="${1:-}" tool="${2:-tool}"
  tvguard_is_loopback "$host" && return 0
  echo "   note: $tool reads from $host, a real device. It changes nothing; the lock in" >&2
  echo "         tools/lib/tvguard.py only covers writing tools." >&2
  return 0
}
