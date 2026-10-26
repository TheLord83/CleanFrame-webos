TL;DR: I ported CleanFrame to LG webOS and added a small config hub. It needs a rooted TV (Homebrew Channel). I'm looking for people who try it and tell me what breaks. Comment or DM and I send you the IPK.

---

The LG home screen annoyed me: the promo row, the recommendations nobody asked for, an app order that resets itself. So I ported CleanFrame, the launcher the Samsung The Frame crowd uses, to webOS and wrote a small service that keeps the configuration.

It runs on my TV, a 43NANO779PA with webOS 6.5. One TV is not a test, so I want to know where it breaks.

What you get:

- a start page with your own tiles, wallpapers and a clock (12 or 24 hour)
- German and English, independent of the TV language
- a senior mode with bigger text, layout still fits
- up to 12 Home Assistant values as a strip above the app bar, switchable with OK, and a page on the TV to hide or rename them
- a remote in the browser that also works inside LG's menus
- no telemetry, no ads

What it needs: a rooted TV. Homebrew Channel, plus Glasshouse for the app list. Sideloading from Developer Mode works too, but without Glasshouse the launcher has no apps to show.

Links: [CleanFrame by Nathan Clark](https://github.com/nthnclrk/CleanFrame), [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), [Glasshouse](https://github.com/rorygallagher2024/glasshouse).

What I'd like from testers: model and webOS version if it doesn't start, which parts fail on webOS 7 and newer or on the C and G series, and whether the Home Assistant values read correctly against your own entities. A photo of a broken screen tells me more than a paragraph.

Caveats: hobby project, no warranty, rooting can void yours. It's a launcher, not a new OS. LG's apps, settings and updates keep working.

The repo is private while this is rough, so comment or DM me for the IPK.
