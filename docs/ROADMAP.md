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

## Next

**Input key** (#8) — done in 0.6.33. Settings → Inputs lists the HDMI ports with their state
(Active / Connected / No device) and the connected device's name where the television knows it;
OK switches over and stays. The list is read on every open, and a television that reports nothing
gets the reason plus "Try again".

**The rest of the picker migration** (#13) — 0.6.33 moved one page (inputs); font, background kind,
focus style, material, clock and language still use button rows. The rows test already knows every
page, so the order is: turn a row's expectation to `picker`, watch the test go red, then change the
page. Each row is one commit and one device check.

**App picker rebuilding itself** (#14) — the sheet says "Apps" and hangs off the home plus anything
else the hub copies over; when that list changes, the entries on the sheet do not necessarily
follow. Every other page is generated from the configuration on each open, this one is not. Small,
unglamorous, and the reason a removed app can still sit in a menu.

**Quiet mode** (#10) — after an idle time only the clock stays. Still needs settling against the
screensaver before either is built (the neighbour that does this dims in steps, shifts the picture
a few pixels per minute for OLED, and can switch the television off after a time — that whole set
belongs in one decision, not three switches).

**Boot and Home through a webOS activity** (#15) — the cheaper half of #5: an activity with a
`bootManager` trigger opens the launcher at power-on, a second one opens it when LG's home shows up.
webOS runs them itself; no init.d hook, no mount, nothing to revert by hand. The lock is the point:
Home stays LG's unless the person asks for the takeover.

**Speed tab** (#12) — frame time, key delay and start-up measured on the television itself. Our own
claims about speed are currently unmeasured, and "it feels fine" is not a report from a stranger.

**Settings backup on a stick** (#16) — one named JSON file on a USB stick, readable back in. It is
the difference between ten seconds after a factory reset and an evening. Seen at two neighbours.

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
