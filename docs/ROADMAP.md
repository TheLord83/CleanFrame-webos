# Where this is going

The list of things worth building, in the order they should be built. Every line here has an issue
in the tracker with the detail; this page is the order and the reasoning.

Two rules for the list. Nothing goes in that another launcher does not already do, or that the
television cannot do at all. And nothing ships that could leave a television without a home screen
until the way back has been tested on a device.

## Now

**Weather line** (#3) — done in 0.5.5. A temperature and a word next to the clock, fetched by the
hub, off by default.

**Recent apps on Back** (#1) — done in 0.5.9. Back opens the last five apps, LG's own home is the
last line, Back closes the list. The list lives on the television, so it works without the hub.

**Splash** (#4) — done in 0.5.9. The packaged start image is a blurred copy of the default wallpaper,
and the page paints the wallpaper that is actually chosen before the configuration arrives.

**Rename and re-icon a tile** (#11) — done in 0.5.9. Hold OK on a tile, Rename or Icon; the icon
catalog is the one the hub uses, plus the app's own icon and plain letters.

**Own wallpaper** (#2) — done in 0.6.0. Upload in the settings page, cropped to 1920x1080 in the
browser and checked again in the hub, stored next to the configuration, fetched by the television
from the hub. The material surface falls back to the picture itself: there are no baked variants
for a picture the package does not know.

**Every selection row is a picker** (#13) — done in 0.6.34. Background kind, layout, app display,
home controls, font, text size, focus style, material, clock, language, the five weather questions
and the inputs are one row each: the value sits in the row, OK opens the answers underneath, up/down
walks the questions. Wallpaper, rotation and the place stay actions, and the inputs keep the
exception the rows test knows about, because their answers come from the television. The rows test
guards the whole list. 0.6.47 fixed what the device showed on two of those pages: "Clock and
language" opened on its second row and "Inputs" on the back button — `tools/test-page-entry.js`
now requires every page to start at row 1.

**The app sheet rebuilds itself** (#14) — done in 0.6.34. Opening the sheet clears the catalog,
reads it again and finds the focus by app id, so an app that was removed cannot stay in the menu and
launch into nothing.

**Speed tab** (#12) — done in 0.6.45. Frame time, key delay and time from start to first picture,
measured on the reference television: 16.7 ms (60/s), 25.5 ms, 2 s. Everything is measured up to the
paint, so the numbers are a floor, and the page says so.

## Next

**Input key** (#8) — done in 0.6.33. Settings → Inputs lists the HDMI ports with their state
(Active / Connected / No device) and the connected device's name where the television knows it;
OK switches over and stays. The list is read on every open, and a television that reports nothing
gets the reason plus "Try again".

**Quiet mode** (#10) — after an idle time only the clock stays. Still needs settling against the
screensaver before either is built (the neighbour that does this dims in steps, shifts the picture
a few pixels per minute for OLED, and can switch the television off after a time — that whole set
belongs in one decision, not three switches).

**Boot and Home through a webOS activity** (#15) — **blocked on this television.** The plan stands: an
activity with a `bootManager` trigger opens the launcher at power-on, a second one opens it when LG's
home shows up. webOS runs them itself; no init.d hook, no mount, nothing to revert by hand. The lock
is the point: Home stays LG's unless the person asks for the takeover.

What stops it is one step below: on this set `luna-send` returns exit code 0 and zero bytes for every
method — before and after a full power cycle, with the launcher running, on both `/usr/bin/luna-send`
and `luna-send-pub`. The hub itself is fine (`ls-monitor` shows `activitymanager/create` offered to
`public`), so the client path is what is mute, and nothing that goes through it — including
`hbchannel/exec` → `activitymanager/create` — can be proven. `docs/COLDSTART.md` holds the
measurements, the one mistake that was made (a `SIGTERM` on `ls-hubd` rebooted the television and took
the running app with it) and what a later attempt should look at first.

**Settings backup on a stick** (#16) — done in 0.6.49. One named JSON file on a USB stick, readable
back in: `cleanframe-settings-YYYY-MM-DD.json`, written by the hub, atomic, 0600, and deliberately
not redacted (a backup without the Home Assistant token restores a launcher that cannot reach its
house). Three states on the page, all honest: no stick, a stick without a backup, a stick with one.
The remaining step is the one that needs a human: a stick in the television.

**Device names at the inputs** (#8, second step) — the input page already shows the name when the
television reports it; making the television report it needs root (`eim` fills that field only for
a privileged caller). Same page, later step, only after #8 proves itself on the device.


## Later, and why

**Replace LG Home** (#5) — the difference between a launcher you open and one you live in. Wanted,
but every neighbour that does it also documents how it goes wrong: a mount in memory, a boot hook
that has to run after the app manager is ready, and a revert that must work without the launcher.
This needs a tested way back before anything else.

**Debloat** (#6) — ACR, voice recognition, ad and telemetry hosts. The reason most people root a
television at all. Belongs in its own script with `--dry-run` and `--restore`, not in a switch
inside the launcher.

**App list and icons without Glasshouse** (#7) — removes a runtime dependency that only exists
because it was convenient. The hub runs as root and can read the app directories itself.

**Watchdog heartbeat** (#9) — done in 0.6.1. The hub writes a timestamp every 30 seconds,
`/api/heartbeat` reports its age, and `tools/watch-hub.py` runs from cron elsewhere and speaks up
when the timestamp stops moving. "The settings page stopped answering" now has a number attached.

## Not doing

**Native rendering with OpenGL.** webOS draws web apps in its own Chromium, which already uses the
GPU; a web app cannot open a GL context of its own. What people mean by this is a native launcher in
C or Rust, which is a different project with a different maintenance load. The launcher is smooth on
the reference television (43NANO779PA, webOS 6.5), so there is no measured problem to solve.

**A second resolution of every wallpaper.** The package is 7,8 MB after 0.5.4. Smaller is possible
and buys nothing.
