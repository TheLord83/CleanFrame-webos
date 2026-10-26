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

---

## B. For r/webos, only with the moderators' approval

Title: Ported an open-source launcher to webOS, looking for a second opinion on newer models

I ported CleanFrame, the launcher the Samsung The Frame crowd uses, to webOS and
run it on a 43NANO779PA with webOS 6.5. The mods are fine with a short post about
it, so this is a request for feedback and not a download page.

What it does: its own start page with app tiles, wallpapers and a clock, German
and English, a senior mode with bigger text, and up to 12 Home Assistant values as
a strip above the app bar that you can switch with OK. Configuration happens in a
browser, which saves a lot of remote work.

What it needs: a rooted TV with Homebrew Channel, plus Glasshouse for the app list.

Where I am stuck: it has only ever run on my one TV. I would like to know whether
it starts on webOS 7 and newer at all, what breaks on OLED sets, and whether the
Home Assistant states read correctly against other people's entities.

The source is on GitHub, and an issue with a photo of the screen is the most
useful thing I can get: <REPO-LINK>

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
