# Reddit post for r/webos

Ready to paste. The title is one code block, the body is one code block below it.

Two images go into the post as a gallery, both already in the repo:

1. `docs/img/launcher.jpg` (1920x1080), the start page
2. `docs/img/hub-home.jpg` (1744x1372), the hub in a browser

The body has two placeholder lines where the pictures belong. On Reddit: upload both images to the
post first, then delete the two lines and the pictures are in place.

Approval: the mod "webos channel icon" answered the modmail with "Sure, you can post it".

## Title

```
CleanFrame: a photo, a clock and your apps as a webOS launcher, now for LG (open source)
```

## Body

```
I ported CleanFrame to LG webOS: https://github.com/TheLord83/CleanFrame-webos

A launcher for rooted LG TVs. The start page is a photo, the clock and your apps. If you run Home Assistant, its values sit on that page and you can switch lamps with the remote. The mods here said a post about it is fine.

What it does:

- wallpaper from a set of photos, background colour taken from the picture
- clock, optionally with the weather next to it; the small server that ships with the app fetches it, so the TV stays offline
- apps in a dock or a grid, as text, icons or both
- Home Assistant values that you name yourself, because sensor.outdoor_temperature is not a label you want to read from the sofa
- lamps and switches on that row, toggled with OK
- settings in the browser on your phone: tile order and names, icons, wallpaper, a live picture of the TV, a remote, senior mode and text size from 20 to 200 percent

[IMAGE 1 HERE: docs/img/launcher.jpg]

[IMAGE 2 HERE: docs/img/hub-home.jpg]

You need a rooted TV. CleanFrame is a normal web app package and installs through the Homebrew Channel (https://github.com/webosbrew/webos-homebrew-channel); rooting is that project's own guide. Home Assistant is optional.

1. Add this as a repository in the Homebrew Channel: https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json
2. Install it from the list and start it once from the app list.
3. Settings: http://<tv-ip>:8484/ while the app runs. Updates come through the channel. The package is 7.8 MB.

What I tested: one TV, a 43NANO779PA on webOS 6.5, and that is the only device this has run on. Other webOS 6 sets should work, webOS 7 I have not touched. The code targets Chromium 79, the browser in webOS 6.

Three things that will annoy someone: it does not take over the Home button, LG's home screen stays the default; the settings answer only while the TV is awake; and uninstalling leaves /var/lib/cleanframe/config.json behind, which holds your Home Assistant token, README says how to remove it.

Does it start on your model, and does the remote focus move where you expect? Put the model and the webOS version in the reply.

The original for Samsung's The Frame is https://github.com/nthnclrk/CleanFrame, this port is unofficial and not his. Glasshouse, which I use to launch apps and trim the TV down: https://github.com/webosbrew/glasshouse. MIT, no warranty, it runs as root on your TV.
```
