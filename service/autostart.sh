#!/bin/sh
# Starts the CleanFrame service at cold boot. Linked into
# /var/lib/webosbrew/init.d/ (no extension) so run-parts picks it up.
#
# Backgrounds the daemon and returns immediately: boot must not wait for it.
# To switch it off: remove the init.d link (tools/uninstall-service.sh).
SVCDIR=/media/developer/apps/usr/palm/services/com.blackpearl.cleanframe.service
WRAP=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service

[ -f "$SVCDIR/service.js" ] || exit 0

# Re-elevate on every boot: a reinstall can reset the dev ACLs, and without the
# "all" group the service may not talk to the application manager.
[ -x /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service ] \
  && node /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service \
       com.blackpearl.cleanframe.service >/dev/null 2>&1

for pid in $(cat /tmp/cfsvc.pid 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done

export NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs
cd "$SVCDIR" || exit 0
if [ -x "$WRAP" ]; then
	nohup "$WRAP" -n "$SVCDIR" --boot --watch >/tmp/cfsvc.out 2>&1 &
else
	nohup /usr/bin/run-js-service -n "$SVCDIR" --boot --watch >/tmp/cfsvc.out 2>&1 &
fi
echo $! > /tmp/cfsvc.pid
exit 0
