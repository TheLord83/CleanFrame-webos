# Reddit post for r/webos

Ready to paste. The title is one code block, the body is another, both in Reddit markdown.

Two images go with the post as a gallery:

1. `docs/img/launcher.jpg` (1920x1080), the start page
2. `docs/img/hub-home.jpg` (1744x1372), the hub in a browser

Inside the body are two placeholder lines in italics, each followed by its caption. Upload the
image, delete the placeholder line, and the caption stays under the picture, which is as close to a
caption as a Reddit gallery gets.

Approval: the mod "webos channel icon" answered the modmail with "Sure, you can post it".

## Title

```
CleanFrame: a photo, a clock and your apps as a webOS launcher, now for LG (open source)
```

## Body

```
I ported [CleanFrame](https://github.com/TheLord83/CleanFrame-webos) to LG webOS. It is a launcher for rooted LG TVs: the start page is a photo, the clock and your apps. If you run Home Assistant, its values sit on that page too and you can switch lamps with the remote. The mods here said a post about it is fine.

*[image 1 goes here: docs/img/launcher.jpg]*
*The start page. A photo, the clock, and the apps you put there yourself.*

*[image 2 goes here: docs/img/hub-home.jpg]*
*The hub in any browser on your network: order and names of the tiles on the left, a live picture of the TV and a remote on the right.*

## What it does

- wallpaper from a set of photos, with the background colour taken from the picture
- clock, and optionally the weather beside it. The small server that ships with the app fetches it, so the TV itself stays offline
- apps in a dock or a grid, as text, as icons, or both
- a row of Home Assistant values that **you name yourself**, because `sensor.outdoor_temperature` is not a label you want to read from the sofa
- lamps and switches on that row, toggled with OK on the remote
- settings in the browser on your phone: tile order and names, icons, wallpaper, a live picture of the TV, a remote, senior mode and text size from 20 to 200 percent

## What you need

- **a rooted TV.** CleanFrame is a normal web app package and installs through the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel). Rooting is that project's own guide, I am not repeating it here.
- optionally Home Assistant. Without it you get the photo, the clock and your apps.

## Installing

1. Add this as a repository in the Homebrew Channel: `https://github.com/TheLord83/CleanFrame-webos/releases/latest/download/repo.json`
2. Install CleanFrame from the channel's list, then start it once from the app list.
3. Settings: `http://<tv-ip>:8484/` while the app runs. Updates come through the channel. The package is 7.8 MB.

## What I tested

One TV, a 43NANO779PA on webOS 6.5, and that is the only device this has run on. Other webOS 6 sets should work, webOS 7 I have not touched. The code targets Chromium 79, the browser inside webOS 6.

## Three things that will annoy someone

- it does not take over the Home button. LG's home screen stays the default.
- the settings answer only while the TV is awake.
- uninstalling leaves `/var/lib/cleanframe/config.json` behind, which holds your Home Assistant token. The [README](https://github.com/TheLord83/CleanFrame-webos#readme) says how to remove it.

## What I would like to know

Does it start on your model, and does the remote focus move where you expect it to? Put the model and the webOS version in the reply.

The [original for Samsung's The Frame](https://github.com/nthnclrk/CleanFrame) is by Nathan Clark, this port is unofficial and not his. [Glasshouse](https://github.com/webosbrew/glasshouse) is what I use to launch apps and to trim the TV down. MIT licence, no warranty, it runs as root on your TV.
```
