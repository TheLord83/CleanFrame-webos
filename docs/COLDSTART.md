# Boot and Home through an activity — and why it is blocked

`#15` was the cheaper half of `#5`: an activity with a `bootManager` trigger that opens the launcher
at power-on, and a second one that opens it when LG's home shows up. webOS runs activities itself, so
there is no init.d hook and no mount to undo by hand. It is still the plan. It cannot be built on this
television, and this file says why, what was measured, and what a later attempt should look at first.

Written on 5 November 2026 for webOS 6.5 (43NANO779PA).

## What is already known

The homebrew service is the only caller on this television that can ask for an activity:

- `org.webosbrew.hbchannel.service` runs as root — `checkRoot` answered `true` and
  `exec {"command": "id"}` answered `uid=0(root) gid=0(root)`.
- It carries its own activity `org.webosbrew.hbchannel.service.autostart`
  (`creator.appId = org.webosbrew.hbchannel.service`, `persist: true`, `foreground: true`,
  trigger `bootManager` / `core-boot-done`), so the service knows the shape of an activity.
- The launcher itself may not create one. A call from the app context is refused with
  `Denied method call "list" for category "/"`: `activities.manage` is not granted to an app, with or
  without `"all"` in `appinfo.json`. The page and its tests therefore build the request but never
  claim that it survives a restart — that was measured, not assumed.

What was never proven: that `hbchannel/exec` → `activitymanager/create` actually returns
`returnValue: true` and an `activityId`. The step order was fixed in advance for exactly this reason:
create a throwaway activity, prove `remove`, and only then touch the real switch.

## What the attempt showed

`luna-send` on this television returns **exit code 0 and zero bytes** — for every method, on every
client name. That is not an error message; the call simply ends without an answer.

Measured, all on 5 November 2026:

| Call | Result |
|---|---|
| `luna-send … applicationmanager/getForegroundAppInfo` | rc=0, 0 bytes |
| same with `-a ares.webos.cli`, `-a com.webos.applicationManager`, `-i`, `-f`, `-m`, `-c 1`, `-n 1 -w 5000` | rc=0, 0 bytes |
| `luna-send-pub` (own binary, own role `com.webos.lunasendpub`, `allowedNames: ["*"]`, `outbound: ["*"]`) | rc=0, 0 bytes |
| `activitymanager/list`, `connectionmanager/getstatus`, `hbchannel/checkRoot` | rc=0, 0 bytes |
| **after a full power cycle** (socket "Fernseher" in Home Assistant, then again by hand) | rc=0, 0 bytes |
| **with the launcher running and writing config** (15:01, `rev=389`) | rc=0, 0 bytes |

The service side is healthy. `ls-monitor` talks to the same hub and answers:

```
com.webos.service.activitymanager  "create": {"provides":["private","activities","activities.manage","public","all"]}
                                   "list":   {"provides":["private","activities.manage","all"]}
```

So the hub offers `create` to `public`, and `ls-hubd` is running — it is the client path that answers
nothing. A missing devmode certificate was the first suspicion (`/var/luna-service2-dev/
devmode_certificate.json` did not exist); creating it with the system's own content
(`{"devmodeGroups": ["ares.webos.cli", "public"]}`, 52 bytes, same as the reference file) changed
nothing. It is still on the television and can be deleted with `rm` — it is not needed for anything
that works.

The hub of this project is not affected: it answered `200` with `version 0.6.51` throughout, and the
app kept reading and writing its config. Only the luna client is mute.

## The mistake that belongs in this file

`ls-hubd` was sent `SIGTERM` to make it read the new certificate. The television **rebooted** and took
the running app with it. Nothing permanent was damaged — the config file was intact and the init
script brought the hub back — but it was a service killed on a device that was in use, and it was not
asked for. Never again:

- no `kill` of `ls-hubd`, `activitymanager` or any other `/usr/sbin` service on the television;
- no writing under `/var/luna-service2*` "to see what happens";
- a restart is decided by the owner of the television, not by a session.

## What a later attempt should try first

1. Find out why the luna client is mute rather than trying to create an activity. Until a single
   `luna-send` returns one byte, nothing above it can be tested.
2. Look at `ls-hubd`'s own log, not at its process state — `wchan` showed `poll_schedule_timeout`
   with a load average of 31, which says "busy", not "broken".
3. Check whether the client permissions directory (`client-permissions.d`) has an entry for the
   caller, and whether the hub is in a security mode that wants a certificate it does not have.
4. Only when `luna-send` answers: throwaway activity → `remove` → then the real switches.

## What stays true either way

- Home stays LG's until the owner asks for the takeover (`#5`). An activity that opens the launcher at
  boot is not the same as replacing Home, and this file does not move that line.
- The launcher works without any of this: it starts from the homebrew menu, or from the app list, and
  from 0.6.49 it can restore its settings from a stick.
