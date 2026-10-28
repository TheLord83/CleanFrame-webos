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

**Input key** (#8) — one button that lists the television's own inputs, which is the only thing a
launcher can make faster than LG's home screen.

**Quiet mode** (#10) — after an idle time only the clock stays. Must be settled against the
screensaver before either is built, so the two do not fight.

**Speed tab** (#12) — frame time, key delay and start-up measured on the television itself. Our own
claims about speed are currently unmeasured, and "it feels fine" is not a report from a stranger.

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

**Watchdog heartbeat** (#9) — converts "the settings page stopped answering" from a mystery into a
fact.

## Not doing

**Native rendering with OpenGL.** webOS draws web apps in its own Chromium, which already uses the
GPU; a web app cannot open a GL context of its own. What people mean by this is a native launcher in
C or Rust, which is a different project with a different maintenance load. The launcher is smooth on
the reference television (43NANO779PA, webOS 6.5), so there is no measured problem to solve.

**A second resolution of every wallpaper.** The package is 7,8 MB after 0.5.4. Smaller is possible
and buys nothing.
