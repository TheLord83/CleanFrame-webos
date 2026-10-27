#!/bin/bash
# Entry point of the installer container.
#
# Without arguments it prints a short help. With arguments it hands them to
# tools/install.sh, so the container behaves exactly like a machine that has the
# repo checked out:
#
#   docker run --rm -it --network host -v "$PWD/..:/cleanframe" cleanframe-installer --dry-run
#   docker run --rm -it --network host -v "$PWD/..:/cleanframe" cleanframe-installer 192.168.1.50
set -u

if [ ! -f /cleanframe/tools/install.sh ]; then
  cat <<'HILFE'
The repo is not mounted. Mount it first:

  docker run --rm -it --network host -v /path/to/cleanframe-webos:/cleanframe cleanframe-installer

Then pass the usual installer options, for example:

  --dry-run                 detect, check and print the plan only
  --info                    model, webOS version, node version
  192.168.1.50            explicit TV address (otherwise the network is searched)
  --launcher-only           install the IPK, no hub, no SSH

Note: --network host is required, otherwise SSDP discovery and the TV on the LAN
are unreachable.
HILFE
  exit 2
fi

if [ "$#" -eq 0 ]; then
  set -- --help
fi

cd /cleanframe || exit 1
exec bash tools/install.sh "$@"
