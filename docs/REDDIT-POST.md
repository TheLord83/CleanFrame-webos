# Reddit post for r/webos

Ready to paste. Title and body are separate code blocks because a phone only lets you copy one block
at a time.

Images, in this order, as a gallery in one post:

1. `docs/img/launcher.jpg`, the start page, photo, clock, six tiles
2. `docs/img/hub-home.jpg`, the hub in a browser, tile list and live picture of the TV

Approval: the mod "webos channel icon" answered the modmail with "Sure, you can post it".

## Title

```
CleanFrame: a photo, a clock and your apps as a webOS launcher, now for LG (open source)
```

## Body

```
I ported CleanFrame, a launcher that Nathan Clark wrote for Samsung's The Frame, to webOS. The start page is a photograph, a clock and your apps. If you run Home Assistant, you can put a few of its values on that page and switch lamps with the remote. The mods here said a post about it is fine.

What it does:

- wallpaper from a set of photographs, with the background colour taken from the picture
- clock, and optionally the weather next to it, fetched by the small server that ships with the app, so the television itself never calls out
- apps in a dock or a grid, as text, as icons, or both
- a row of Home Assistant values that you pick and name yourself, because sensor.outdoor_temperature is not a label you want to read from the sofa
- lamps and switches on that row, toggled with OK on the remote
- settings in the browser on your phone: order and names of the tiles, icons, wallpaper, a live picture of the TV, and a remote
- senior mode with larger text, and a text size from 20 to 200 percent
- backup and restore of the whole configuration
- MQTT status and update blocking, if you run Glasshouse

What you need:

- a rooted television. The launcher is a normal web app package, it installs through the Homebrew Channel, and getting there needs root. Rooting is the Homebrew Channel's own guide, I am not repeating it here.
- optionally Home Assistant. Without it you get the photograph, the clock and your apps.

Installing:

1. Add this address as a repository in the Homebrew Channel: https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
2. CleanFrame appears in the channel's list. Install it like any other app.
3. Start it once from the app list. The settings live at http://<tv-ip>:8484/ while the app is running.
4. Updates arrive through the channel when I publish a new version. The package is 7.8 MB.

The other two ways, a script over SSH and installing by hand with Dev Manager, are in the README.

What I have actually tested: one television, a 43NANO779PA on webOS 6.5, and that is the only device this has run on. Other webOS 6 sets should work. webOS 7 and newer I have not touched, and I would rather hear that it breaks on your C2 than guess about it. The code targets Chromium 79, the browser inside webOS 6.

Things that will annoy someone:

- it does not take over the Home button. LG's home screen stays the default, and CleanFrame starts from the app list like any other app.
- the settings page runs on the television, so it answers only while the TV is awake. There is a documented way to install that server permanently; this is not the default.
- if you uninstall the app, one file stays behind: /var/lib/cleanframe/config.json, which holds the Home Assistant token. The README says how to remove it.

Two things I would like to know from you. Does it start at all on your model, and does the remote feel right, meaning the focus moves where you expect it to. Put the model and the webOS version in the reply. That is the part I cannot test on one set.

Links: the code and the documentation are at https://github.com/TheLord83/CleanFrame-webos. The original for Tizen is https://github.com/nthnclrk/CleanFrame, and the webOS port is unofficial and not maintained by him. The Homebrew Channel is https://github.com/webosbrew/webos-homebrew-channel, and Glasshouse, which I use to launch apps and to trim the TV down before any of this is useful, is https://github.com/webosbrew/glasshouse.

MIT licence, no warranty. It runs as root on your television, and that is your decision to make.
```
