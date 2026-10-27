# Beta post, three texts for three situations

r/webos says: "No unapproved adverts or promotion at all." A post that ends with
"comment or DM me and I will send you the IPK" is exactly what that rule is aimed
at, so that text would probably be removed. Pick one of the three below; they are
not meant to be posted together.

---

## A. Modmail to the r/webos moderators, send this first

Subject: Permission for one post about a webOS homebrew launcher?

Hi mods,

I ported the open-source CleanFrame launcher to webOS and wrote a small config
service for it. It runs on my own TV (43NANO779PA, webOS 6.5) and I would like to
ask a few people with other models whether it works there too. Nothing for sale,
no IPTV, no account, no ads, and it is not my job.

Before I post anything: is that welcome here, and if so in which form? I can post
it as a plain text post asking for feedback, or keep it to a comment in an
existing homebrew thread if you prefer that. I can also send you the draft first.

If the answer is no, that is fine and I will leave it.

Thanks.

**Status 2026-10-27: answered, "Sure, you can post it."**

---

## B1. Approved version, paste as is (r/webos, 2026-10-27)

Formatted after reading what lands in the sub: Luma, Hearth and Lightkeeper all
lead with one sentence of why, then a picture, then flat feature bullets, then
"what you need", then install steps, then the honest limits. Reddit renders
markdown in self-posts, so the sections use `##` headings and the three links
(upstream, Homebrew Channel, Glasshouse) are inline.

The one link that is missing is the port's own repository, because it is still
private. Once it is public, replace the sentence in the second paragraph with
"my port is at [TheLord83/CleanFrame-webos](https://github.com/TheLord83/CleanFrame-webos)"
and put the same URL in install step 2 instead of "ask me in the thread".

Title:

```
CleanFrame on webOS: a quiet start page with Home Assistant values on it (rooted TVs, looking for feedback)
```

Body (Reddit markdown, paste as is):

---

CleanFrame is an open-source launcher (MIT) that the Samsung The Frame crowd uses. I ported
it to webOS and wrote a small service that keeps its settings. You can read the original at
[nthnclrk/CleanFrame](https://github.com/nthnclrk/CleanFrame), my port lives in a separate
repository that I will link as soon as I have made it public.

The quiet start page is not new by now, Luma, Hearth and Lightkeeper all do that nicer than LG
does. What I have not seen yet: **up to 12 Home Assistant values as a strip on the start page,
switchable with the remote.**

I have only one TV to test on, a 43NANO779PA with webOS 6.5, and the mods said a feedback post
is fine. So that is what this is.

## The three screens above

1. the start page with tiles and the value strip
2. Settings, Values on the start page, where you hide and rename values on the TV itself
3. the same settings in a phone browser

## What it does

- own start page with app tiles, 15 bundled wallpapers, clock in 12 or 24 h
- German and English, independent of the TV language
- senior mode with 160 % text; the layout reflows instead of overlapping
- up to 12 Home Assistant entities as chips above the app bar; `OK` toggles light, switch,
  helper and fan, everything else only displays
- a page on the TV to hide or rename those values, adding entities stays in the browser
- a remote in the browser that also works while LG's own menus are open (SSAP, no Home
  Assistant needed)
- a screenshot of what is on the TV, straight into the browser
- no telemetry, no cloud, one JSON file on the TV, backup button

## What you need

- a rooted TV with the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).
  Rooting is their guide's job, not mine
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse), installed and running. The
  launcher takes its whole app list from it, without Glasshouse you get an empty dock
- webOS 6.5 is tested. 7, 9, 10, 11 and OLED are untested, that is the point of this post

## Install, about five minutes

1. Glasshouse installed and opened once
2. ask me in the thread for the IPK, or build it from the source
3. Glasshouse, **Apps**, install the IPK, launch CleanFrame once
4. `http://<TV-IP>:8484` in a browser for the settings

## Will it eat my Home screen?

No. CleanFrame is an app, the Home key still opens LG's home. The home-button hook exists in
the tree but is off, so a bad uninstall cannot leave you without a start page.

## What I would like to know

- does it start at all on webOS 7, 9, 10, 11
- what breaks on OLED sets (C and G series)
- do the Home Assistant values read correctly against your own entities
- is 650 ms the right long-press for the tile menu, or too slow

Model, webOS version and a photo of a broken screen is a perfect report.

## Caveats

Hobby project, no warranty, rooting can void yours. It is a launcher, not a new OS, LG's apps,
settings and updates keep working.

---

Images, in this order: `beta-start-page.jpg`, `beta-values-page.jpg`,
`beta-hub-mobile.png`.

### Notes for later

- The sub has `awesome-webos` and `Native-Webos/webos-apps-repo`; both are the way
  a launcher becomes findable. Worth a PR once the repo is public.
- Every launcher post there carries a GitHub link. While ours is private, the post
  is the only one without one, which is exactly what makes it look like an advert.
  Publishing the repo is the real fix, not more words.

---

## C. For r/selfhosted or r/homelab, project post with a public repo

Title: I put a quiet home screen on my LG TV, with Home Assistant values on it

The LG home screen does not let you arrange much and pushes a recommendation row.
I ported CleanFrame (MIT, originally for Samsung The Frame) to webOS and wrote a
small Node service that holds the configuration, so setting it up is a browser job
instead of a remote job.

On the TV: own tiles, wallpapers, a clock, German and English, a senior mode with
bigger text, and a strip with up to 12 Home Assistant values that can be switched
with OK.

Next to it: the hub serves the config page and a REST API, sends screenshots, and
offers a remote that also works inside LG's menus. No telemetry, no cloud, one
JSON file, and a backup button.

All of it needs a rooted TV (Homebrew Channel plus Glasshouse). One device is not
a test, so reports from other models are welcome.

Code and install notes: <REPO-LINK>
