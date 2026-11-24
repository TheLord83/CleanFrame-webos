## 0.8.7

**LG Home stays when it is wanted.** Since the launcher replaces LG's home screen at once, an explicit
"open LG Home" (Settings -> LG Home) had no chance: the service took the screen back in the same
second. The app now sets a 120 second hold at the hub (`POST /api/tv/hold`) before it opens the home
screen, and the service asks before it comes back. Without the hold everything stays as it was.

## 0.8.6

**HDMI 1 was never a permissions problem - the inputs page refused to switch.** `"Laeuft gerade"` was
not a television error but our own label: the app treated the input's `activate` flag as "this is on
screen" and answered an OK press with "This input is already running". The flag only means "last
chosen": while the launcher is in front, the television keeps reporting the input underneath as
active. So the page blocked exactly the case it exists for. It now always switches, and the state line
says "Zuletzt gewaehlt" instead of claiming the input is running. The hub path added in 0.8.0 (a port
is its own native app, started over SSAP) carries the switch.

## 0.8.5

**Which build is running is now visible, not guessed.** The hub's System page shows two lines: the
version in the package and the version the launcher reports from memory (`build.js`, written by the
packer). If they differ, the page says so. The reload now changes the document address
(`?v=<version>`) instead of calling `location.reload()`, which did not reliably fetch the new files on
this television.

## 0.8.4

**No grace period any more.** 0.8.0 held the home screen for 15 seconds so a person pressing HOME
could look at it. That was my idea, not the requirement: the launcher is meant to replace LG's home
screen, so every appearance is replaced at once - measured at under a second via the hub's SSAP path.

## 0.8.3

**The launcher now replaces itself after an update.** A package replaces the files but does not reload
a running app, and closing it from outside is not permitted on this television - `close` answers
`no app matched by pid` for both the app id and the process id. So the hub tells which version is
installed (`GET /api/tv/appversion`), the launcher remembers the one it loaded with and reloads itself
when they differ. From this version on, an update reaches the screen without anyone rebooting.

## 0.8.2

**An update now really replaces the running code.** Installing a package does not reload a running
app, so the launcher kept executing the old JavaScript - which is why the HDMI fix from 0.8.0 never
reached the screen. Closing over SSAP does not work on this television (`closed: false`), so the
service does it over luna, where it has the rights: `--reload` closes the app and starts it again,
and `tools/install-ipk.py` passes that flag after every install.

## 0.8.1

**Coming back does not go through luna any more.** Measured with a real HOME press: the key arrives, the
launch answers `true`, and LG swallows it while its home screen is still starting - five attempts in a
row, all accepted, none effective. The same launch over the hub's paired SSAP channel works in exactly
that state (`{"ok":true,"via":"ssap"}`, checked on a screenshot). So the service now asks the hub
(`POST /api/tv/front`), keeps luna as fallback, and retries for up to 25 seconds instead of six tries.

**An update now really replaces the running code.** Installing a package does not reload a running
app, so the launcher kept executing the old JavaScript - which is why the HDMI fix from 0.8.0 did not
reach the screen. `POST /api/tv/reload` closes the app over SSAP and starts it again;
`tools/install-ipk.py` calls it after every install.

## 0.8.0

**The inputs page can switch HDMI again.** Inside the launcher webOS refuses the input services
(`Not permitted to send to com.webos.service.eim`, same for apiadapter and utp.extinputs), which is
why picking HDMI 1 ended in "something is running" and nothing happened. A port is its own native app
on this television (`com.webos.app.hdmi1..4`), and the hub may start it: the app now asks the hub
first, the old luna paths stay as fallback. Measured on the device - `{"ok":true,"via":"ssap"}` and
the screen really switched to HDMI 1.

**The home screen stays out of the way at power-on.** Right after boot nobody wants to see LG's home,
so the service brings the launcher back immediately. Pressing HOME later is respected for the first
15 seconds - whoever presses it wants to see it, a second press comes back. Before, every appearance
of the home screen was treated as an accident.

## 0.7.2

**The home screen swallowed the first launch.** Looking at the television - not at the return value -
showed LG's home screen still in front although `launch` answered `true`, and the log showed why: the
foreground never changed, so a "launch once per appearance" rule never tried again. The service now
retries up to six times while the home screen is in front and stops as soon as the launcher is there.
Verified with the hub's own home button: two presses, each back in the launcher after one second, both
checked against a screenshot of the panel.

## 0.7.1

**The HOME key now works - and not because of the key.** Reading `/dev/input` never saw the HOME
press on this television (no code 773 arrived while the launcher was in front), while the
application manager reports every foreground change. So the service now asks once a second what is in
front and comes back as soon as LG's home screen appears -- measured at under a second, and
independent of the remote. The key reading stays as the faster path, now with `CF_DEBUG_KEYS=1`
logging every key so a different code on another remote can be found instead of guessed.

## 0.7.0

**The launcher can now start itself — and answer the HOME key.** webOS only lets a *registered*
service talk to the application manager; a root script, `init.d` or a plain node process is refused
with `Not permitted to send to com.webos.applicationManager`, and the activity manager does not even
exist on webOS 6.5 (which is why the two switches on the start page said "not available"). The start
service therefore ships inside this package (`services/com.blackpearl.cleanframe.svc`), because only
the package manager can register it with the identity that is allowed to launch an app. It waits for
the application manager after a cold boot and reads the remote for the HOME key — all input devices,
non-blocking, code 773 as measured on this remote, no `grab`, so the normal remote keeps working.
Removing the `init.d` link switches both off again.

## 0.6.63

**A place with "Off" in the summary could not be switched on again.** The hub keeps the on/off state
and the shape in two fields, and an older version of this app left `enabled` false while `style` still
said "Symbol and temperature" — the television then showed the shape as chosen and the line stayed
silent, with no way back. What counts now is what is on screen: with `enabled` off, "Off" is the chosen
answer, and picking a shape switches the weather on.

## 0.6.62

**Weather stayed off after a place was set.** "Shown as" and "on/off" are two fields in the hub
(`style` and `enabled`); the television only has the first one, so setting it left `enabled` false and
the line silent — place there, nothing to see. Picking a style now writes both, picking a place in the
search switches the weather on unless the style says "Off", and the summary row reads "Off" when either
field says so.

**"Kiel, DE" found nothing in the place search.** Open-Meteo searches names, not "name, country": the
appended country code turned six hits into an empty list, and the page said no place by that name. The
search now splits the input and narrows the hits to the given country, like the geocoder already did.

**The place sheet's instruction sat inside the field.** The box, its status line and the list moved
20 px down together.

**Inputs:** the numbers no longer sit on green, the running state is not tinted, the text has room next
to the number, and the sentence about a missing HDMI picture is gone — it explained the implementation
to someone who just wanted to switch inputs.

## 0.6.61

**Inputs are their own page now.** The group page wrapped the sockets in a picker: one collapsed row
that had to be opened to see the others, so you could not tell at a glance what was plugged in. Now
the page is two columns — the sockets on the left with their number, device name and state ("Running
now", "Device connected", "No device"), the highlighted one on the right with its details. OK switches
to it; the running input says so instead of switching a picture that is already there.

A live picture of the input is not possible and the page says so: webOS hands the HDMI signal to the
system tuner only, there is no capture interface an app could draw from. What the page can show is
everything the television reports about the socket, plus the one action that matters.

**The Inputs icon was a box with two lines.** Replaced with the HDMI socket as it is printed on every
device: wide top, narrower bottom, notch in the middle, two contact strips.

**The stick page showed a date before it had read anything.** `openStick()` drew the page first and read
afterwards, so the row carried the previous state's date and looked like the stick's answer. It now
clears the state, shows "Looking at the stick ..." and prints the date only once it has been read.

**"Values on the start page" said nothing useful** when the hub had no entities. The row now says
"none yet - choose them in the hub", the page explains that these are Home Assistant values and where
to pick them.

**The place search had its instruction twice** and the line was drawn into the field. One line only;
the field has no text of its own.

## 0.6.60

The three things the operator hit while actually setting a place on the television.

**Back in the result list opened the keyboard instead of leaving.** Back was "one level per press":
results → field → out. Reaching the field starts the on-screen keyboard again, so back looked like
"jumps back into the field". Back now leaves the sheet, from the field as well as from the list — and
the field swallows the remote's back itself (27, 8, 10009, 461), so the keypress is not just lost
inside the input element.

**The instruction stood twice on the page.** The field carried a placeholder with the same sentence as
the line above it. One line now, the field has no placeholder text of its own.

**"place not found" came from a hub that never got the fix.** The launcher updates through the IPK, the
hub under `/var/lib/cleanframe` does not — it still held the 5 November build with `count=1` and no
country check. Measured on the device: `/api/weather/place` with `Kiel, DE` answered `place not found`
while the same question against the repo state answered `54.3213 / 10.1349`. The hub was reinstalled
(`tools/install-hub.sh`), now reports 0.6.59, and the television itself answers `{"ok":true,"place":"Kiel, DE"}`.
The app also sends `application/json` now instead of `text/plain`, the type the hub accepts from any
client, and shows a plain sentence instead of the server's raw error text.

## 0.6.59

Three things the operator saw on the television.

**"Wird gespeichert ..." stood between the first and second result.** The status and the error were
rendered into the result list, so they became a block that pushed the rows down and sat in the middle
of the list. There is a status line between the field and the list now (own element, 34 px high, its
space is always reserved so nothing jumps when a message appears or goes away).

**The list overlapped the field.** `.place-search-results` was at 322 while the box ends at 253 and the
status needs its own row: the highlighted first row touched the field. List at 342, status at 278, box
at 216 — measured and looked at, no overlap left between field, error line and first row.

**The Inputs icon was missing from the utility bar.** `UTIL` had an entry for `inputs`, but `utils()`
returned `['art', 'apps', 'arrange', 'settings']` — four buttons, and "arrange" was rendered with no
icon. `utils()` is now `['art', 'apps', 'inputs', 'settings']` and the bar is drawn from `UTIL`, so every
button carries the shape of its job. Measured: Bildschirmschoner, Alle Apps, Eingänge, Einstellungen,
each with its own icon.

## 0.6.58

Two faults the operator hit on the television right after 0.6.57, both visible only on the device.

**The hint line was overprinted by the field.** `.s-sub` sits at y=148, `.place-search-box` was in
normal flow and landed on the same place, so "Namen des Ortes eintippen…" and the input box wrote on
top of each other. The box is positioned now (216), the result list starts below it (322), and the
list only draws as many rows as fit above the hint line at 968 — a long list used to push the hint
out of the picture. The inner list and the error line are static inside their container; otherwise
`.settings-overview`'s absolute position would have thrown them back up over the field.

**Picking a place answered `place not found`.** The candidate carries `name: "Kiel, DE"`, the page
sent exactly that back, and `geocode()` passed it straight to Open-Meteo — which only knows the bare
name, so the answer was empty and the hub reported the failure over the text. `geocode()` now splits
name and country code, asks with the full text first, then with the bare name, and picks the hit whose
name ends in the wanted country code instead of trusting the first result. A country that does not
appear is still a failure — silently setting another place would be worse than the message.
Measured: `Kiel, DE` → lat 54.3213 lon 10.1349, `Kiel, US` → 43.9125 / -88.0356, `Kiel` → Kiel DE,
`Kiel, XX` → `place not found`.

## 0.6.57

The place search had no way out. Once the field had the focus, webOS kept its on-screen keyboard open,
every redraw pulled the focus back into the field, and the arrow keys moved a text cursor instead of
the list — so the candidates were unreachable and the whole screen could only be left by closing the
page. That is exactly what the operator reported on 24.11.

OK in the field now searches **and hands the focus to the results**: the keyboard closes, the first
candidate is highlighted, up/down walk the list, up from the first candidate returns to the field (the
keyboard opens again), and OK on a candidate writes it. `FILLS.placesearch` only focuses the field
while the field *is* the phase, so a redraw can no longer drag the focus back in. The hint line follows
the phase: it says "OK sucht, Fertig verlässt die Tastatur" in the field and "OK nimmt den Ort, hoch
zurück ins Feld" in the list.

The place list is gone. It could only offer places the hub already knew and sent everyone else to the
browser, which is the wrong place for someone sitting in front of the television; the operator chose
keyboard only. `openPlace()` goes straight to the search, `V.place`, `FRAMES.place`, `FILLS.place`,
`placeRows()`, `wxPlaceChoices()` and `weatherPlace()` are removed.

`tools/test-place-search.js` now checks the transitions the report was about (23 checks): after the
search the focus is *not* in the field, up from the first candidate returns to it, down leaves it
again, OK takes the highlighted candidate, and back leaves the sheet. `tools/test-place-sheet.js`
follows the new entry (14 checks) and keeps the guard that no "undefined" ever appears in the sheet.

## 0.6.56

Inputs are not a setting. Switching to HDMI 2 changes nothing permanent, it is an action — and it
lived in Settings next to things you configure once. It is in the home screen's utility row now, next
to Screensaver, All apps and Settings: one keypress from the home screen, and the settings overview is
down to 13 rows.

The row of the settings overview and its route are gone; the page itself is the same one, so nothing
was rebuilt. `tools/test-settings-rows.js` and `tools/test-page-entry.js` follow the new way in, and
the entry test now says what it can actually prove on a bench without an EIM: the focus starts on the
page's list and not on the back button.

## 0.6.55

A place can be set on the television. Until now the place sheet showed the places the hub already knew
and told you that new ones are added in the browser — which is the wrong place to send someone who is
sitting in front of the television.

Row 0 of that sheet is now "Search for a place". It opens a real `<input>`, and a real input is the
point: webOS shows its on-screen keyboard for a focused field, so the name arrives with the remote
rather than through a letter grid. `GET /api/weather/places?q=` returns up to six candidates, because
"Kiel" is a town in Schleswig-Holstein and one in Wisconsin; the list shows name and region, up/down
picks, OK takes it and writes the place through the same endpoint the browser uses. Back from the
results returns to the field first, the second back leaves the sheet.

`tools/test-place-search.js` (19 checks) runs the whole path against a stubbed hub: the field exists
and holds the focus, OK sends the typed name, both candidates appear as rows, OK takes the one that is
highlighted and not the first, and an empty answer says so.

## 0.6.54

Two things the owner saw on the television, both fixed where they come from.

The restore row wrote over the picture: its label was "Restore from stick · 05.11.2026", 768 pixels of
text in a 640 pixel card. The row is a flex child with `min-width: auto`, so the text was allowed to
make it wider than the card instead of being cut. Now every row truncates itself with an ellipsis, and
the date moved out of the button into the reason line under it — a button says what it does, and when
the backup was written belongs beside it. `tools/test-stick-page.js` checks both: no element on the
page may report a scroll width larger than its client width, and the date may not sit in the button.

"Typography" and "Text size" were two rows that opened the same page. One row now: font and size in
one value, one way in.

## 0.6.53

The place sheet no longer contains a corpse. The free-text path was dead — nothing had set `place:
true` since the rebuild — but it was still in the file twice: `placeKey()` with its cursor and clear
branches, and a second branch in the rename template that drew a text field plus "Search in the hub".
Both are gone, and the sentence that promised typing went with them: an empty place list used to
answer OK with "Choose a place from the list or type a name" on a television that has no keyboard.
What the sheet says now is where a place actually comes from, and `tools/test-place-sheet.js` checks
that the words for typing never appear — before and after pressing OK on an empty list.

Four translation keys had no user left and were removed with the code.

## 0.6.52

An NTFS stick was invisible. The television mounts one with its own driver and writes `tntfs` into
`/proc/mounts`; the list of filesystems a stick arrives with had `ntfs` but not `tntfs`, so the page
said "No stick found" while a 244 GB stick sat mounted read-write at `/tmp/usb/sda/sda1` — measured on
the device, not suspected.

`tntfs` is in the list now, and the sentence on the page names NTFS as well. `sticks()` takes a mount
table as an argument, so the bench can test the cases a developer's machine does not have:
`tools/test-stick-fs.js`, 21 checks — a webOS NTFS mount counts, the television's own ext4 partition
does not, a read-only mount is no target, pseudo filesystems stay out, two sticks without a backup are
a question and not a choice.

## 0.6.51

The footer said "Open on the TV" for every row that it had no sentence for - on the stick page for a
row that does nothing, and on the start-up page for a switch. A hint that promises something that
does not happen is the same lie as a row that promises it. Both pages say what they do now: nothing
on an information row, "Save" and "Restore" on the buttons, "Switch on or off" on the switches.
Checked in `tools/test-stick-page.js` (28 checks) and `tools/test-startup-page.js` (25).

## 0.6.50

The stick page reports what it sees in `/api/ui/state` while it is open: which stick was found, which
file is on it, and the reason when there is none. An acceptance that only has a photograph of a
sentence can read a sentence, not a state.

## 0.6.49

Settings → "Backup to a stick": one named JSON file on a USB stick, and reading it back in.
The difference between ten seconds after a factory reset and an evening.

The hub does the filesystem work (it runs as root on the television and can see the mounts),
the page only asks and shows. Three states, all three of which occur and none of which is dressed
up as an error: no stick, a stick without a backup, a stick with one.

- The stick is found in `/proc/mounts`, never guessed: a block device (`/dev/sd*`, `/dev/disk/by-*`)
  with a stick filesystem (vfat/exfat/ntfs/ext) mounted read-write. The television's own storage and
  the pseudo filesystems under `/media` are excluded.
- The file is written atomically (tmp + rename) as `cleanframe-settings-YYYY-MM-DD.json`, mode 0600.
  It is deliberately **not** redacted: a backup without the Home Assistant token and the MQTT
  password restores a launcher that cannot reach its house. The page says so in the row.
- Reading it back checks the envelope (kind, schema version, a config object) and refuses a newer
  schema rather than half-importing one. A foreign file, a truncated file and a path instead of a
  name are all refused with a reason, and the configuration is left untouched.
- `CF_STICK` points the module at a directory, which is how the bench tests the whole chain without
  a USB port.

Two checks: `tools/test-stick-api.py` drives a real hub against a temporary stick (40 checks: name,
size, checksum, mode, the token actually in the file, restore puts the value back, foreign/broken/
newer files refused, no stick is a 409 and not a crash), `tools/test-stick-page.js` stands in for the
hub with `window.fetch` and checks what the page shows and sends in all three states (26 checks).

Not yet on the device: the page is installed with this build; a stick in the television is the test.

## 0.6.48

Settings → "Start with the TV": two switches, both off, both alone — open CleanFrame after
start-up, open it when LG's home shows up.

These are webOS activities, not a mount. webOS runs them itself, they survive a reboot, and a wrong
one means "the app does not open" rather than "the television has no home screen". It is the cheaper
half of the home takeover (#5) and the reason it is built first: there is nothing to undo by hand.
LG's home stays where it is; nothing is stopped.

The two triggers: `bootManager/getBootStatus` subscribed for `core-boot-done`, and
`applicationManager/getForegroundAppInfo`, both with `applicationManager/launch` on the app's own id,
`persist: true`, `foreground: true`. The page shows what the television reports — an activity it does
not know is a switch on "Off", and a missing service says so instead of offering a switch that would
do nothing.

`tools/test-startup-page.js` reads the payload off a stand-in bus: the call goes to
`activitymanager/create`, `start: true`, `persist: true`, `foreground: true`, the trigger is a
subscription with `core-boot-done`, the callback launches `com.blackpearl.cleanframe`; the second
trigger hangs on the foreground app info. Switch on, the row says On; switch off, Off.

Not yet on the device: the television runs the service (`/usr/sbin/activitymanager`, pid 3345) but
answers `luna-send` with nothing, so the request is installed with this build and the next power
cycle is the test.

## 0.6.47

Every settings page started somewhere, rarely at the top.

Measured on the television: "Clock and language" opened with the focus on the
second row (Language, not Clock), and "Inputs" opened with the focus on the back
button. Both pages have no single axis, so `openAppearance()` fell back to an
action that only exists on the LG page — and a row that cannot be found resolves
to row 0, which is the way back.

Pages now name their first row, and an action that does not exist on the page
falls to its first real row. The input list is read from the television, so its
rows appear late: the focus follows the list once it arrives.

`tools/test-page-entry.js` walks every entry of the settings overview and requires
row 1 and: the focus not on the back button. The old code fails six of its checks
(`clocklang row=2 action=pick.lang`, `inputs row=0 action=settings.back`); the
device said the same before the fix.

## 0.6.46

The layout report counted what is not on the screen.

On the television, with eight apps in the dock, `/api/ui/state` said `fits: false,
right: 2472` — and the picture was fine. The tiles beyond the dock's edge live
inside `.shelf`, which is `overflow: hidden`: they sit outside the visible window
on purpose, reachable by walking the strip, not cut off. The report measured them
anyway and called a working page too full.

Elements are now measured inside their clipping ancestor, and a strip that hides
whole tiles is named in `scrolls`, so the smaller number never appears silently. A
tile that is merely spliced at the edge stays in the measurement — its visible part
is on screen.

`tools/test-layout-fit.js` builds its own clipped box (one button inside, one
pushed outside) and requires that the hidden one is not counted and the container is
named. With the old code that case reports `fits: false, right: 1976`.

## 0.6.45

The Speed page has a heading.

`DETAIL_NAMES` did not know the new group, so the page carried its three rows under
an empty title — visible on the first look at the TV, invisible on the bench because
nobody looked at the top of the page. The test asks for the heading now.

## 0.6.44

The frame measurement now ends on a clock, not on a frame count.

On the television a frame stood about 28 ms, so a hundred and twenty frames meant
well over four seconds of a page saying "not measured yet" — long enough to look
like a page that does nothing. Two seconds of frames is the budget now, and the
number of samples is part of the result, so a slow device reports a thin median
instead of nothing. Found by pressing OK on the reference TV, not on the bench:
there the frame rate is 60/s and the old version finished in seconds.

## 0.6.43

A Speed page that measures instead of claiming.

Roadmap #12: the project said "it feels smooth", which is not a measurement. Settings → Speed now
measures three things on the television itself — frame time (median and 95th percentile over a hundred
frames), the delay from a key press to the next frame, and the time from start to the first picture.
Each row measures again when you press OK on it. Before the first measurement a row says
"not measured yet" rather than showing a number nobody took. The row also says what the number is:
measured up to the paint, so a lower bound.

Two faults found while building it, both the silent kind: the page had no first row, so the focus sat
on the last one and the arrows did nothing; and its rows carried the value in a field the row builder
never reads, so they were invisible *and* operable. `tools/test-speed-page.js` now checks the three
rows, a real measurement, the honest empty state, and that the page reports what it shows.

## 0.6.42

The baked setup matrix is gone, together with the script that produced it.

`app/assets/qr-setup.js` and `tools/make-qr.py` had no reader left after 0.6.39 —
the app computes the matrix from the address it reads off the device. Keeping a
second, wrong answer in the package would only invite someone to trust it later.
The test keeps its guard: `index.html` must not load a `qr-setup.js` again.

## 0.6.41

The setup note showed no code at all.

The address arrives a moment after the dialog is drawn, so the dialog is drawn a
second time — and the cache key did not include the address, so the second draw
kept the old markup and only the text slots were written again. The result was a
note with doubled, overlapping lines and no code. The key now carries the
address, and `tools/test-setup-qr.js` looks at the dialog itself: no code without
an address (plus a sentence saying so), exactly one code with one, and the
heading exactly once in both cases.

## 0.6.40

The hub could not say what its own address was.

`/api/net` answered 500 with `Cannot read property 'networkInterfaces' of
undefined`. Not a missing module: another function in the same file declares
`var os = info.os`, and in JavaScript that hoists over the module variable for
the whole enclosing scope — so the address endpoint was holding `undefined`
instead of the module. The module now has its own name, and the endpoint has two
sources: the interface list, and the address the request actually arrived on
(which is the honest answer to "how does a phone reach me?" — except over
loopback, where it says 127.0.0.1 and is worthless to a phone).

`tools/check-net-endpoint.py` asks a running hub instead of the function: it
starts one on a free port and checks that the address it offers is usable in the
LAN, is the address of that machine, is not offered twice, and that neither
127.x nor 169.254.x ever appears.

## 0.6.39

The setup code now points at the television, and it is drawn on the television.

**The address is the device's own.** The code carried a DNS name that only exists in one particular
network. It now asks the television for its LAN address (Luna `connectionmanager`, with the hub's
`/api/net` as a fallback) and shows `http://<ip>:8484/`. Loopback and self-assigned `169.254.`
addresses are refused: a phone in the same network cannot do anything with them. Without an address
the note says so instead of drawing a code that leads nowhere.

**The matrix is built on the device, not at build time.** `tools/make-qr.py` baked a finished matrix
into the package for a fixed name; the encoder (`qrcode-generator`, MIT, vendored) now runs in the app,
from the address it just looked up. A package no longer has to be rebuilt when a television gets a new
address.

`tools/test-setup-qr.js` checks both, and has an independent decoder (zxing-cpp) read the address back
out of the picture — a matrix that only agrees with itself proves nothing.

## 0.6.38

Three faults that only showed up on the TV, and the guards that would have caught them.

**The place sheet was a blank page saying "undefined".** `place` appeared twice in the same object
literal — the real frame and an empty copy from `FILLS` — and the later key wins, so `FRAMES.place()`
returned `undefined` and that string went straight into `innerHTML`. The empty entry is gone, and the
place list now has a source: the hub stores resolved places with their coordinates (`weather.known`,
eight of them), because a name without latitude and longitude would just relabel the weather of the
old place.

**The input calls never reached the TV.** `com.webos.service.eim` and friends were called with the
method inside the payload (`{method: 'getAllInputStatus', parameters: {...}}`); `PalmServiceBridge`
only routes when the method sits in the URI. Every call sat in the timeout, and the page reported "the
TV reported no inputs" while the service was running — measured on the device with `ps`. All four call
sites now put the method in the URI, and `tools/check-luna-uris.py` fails the build if one ever does
not: it is the only check that can catch this, since the bench has no Luna.

**Two empty HDMI sockets were called "Verbunden".** The TV only sends `connected: true` when something
is attached and marks the running input with `activate`; the page read `d.connected !== false` and
`d.active`, so a missing field meant "connected" and the active marker was always false. Both now read
the field the device sends, pinned by `tools/test-inputs-page.js` with the measured answer.

The inputs page also tells you why it is empty now: the service's own answer is printed next to the
message instead of being swallowed.

## 0.6.34

Every selection row is a picker now, and the app sheet stops lying about what is installed.

**Six rows migrated.** Font, background type, focus style, material, clock and language used to be
button rows — the pattern that made selecting feel wrong on the weather line. They now open their
answers underneath like every other row. Nothing new to learn: the rows test already knew all pages,
so each row went red first and green after the change.

**The app sheet rebuilds itself.** It was the only page that kept its entries from the last visit; a
removed app stayed in the menu and launched into nothing. Opening it now clears the catalogue and
reads it again, and the highlight follows the app rather than its position — a list that changed
underneath no longer moves the cursor onto a neighbour. There is a test for it
(`tools/test-apps-catalog.js`), and the bench gets its list from a stub because there is no Luna on
the bench.

**Two crashes fixed on the way**, both found by walking the pages:

- `renderSheet` asked `FRAMES` for a settings page. The place page had an empty `FILLS` entry for the
  same reason; opening the inputs page raised `TypeError: FRAMES[t.id] is not a function`. Settings
  pages are drawn by `renderAppearance`, and `renderSheet` no longer pokes at them.
- "Run setup again" called `saveConfig` without a callback and raised
  `TypeError: cb is not a function` — the bug that was known since 0.6.32 and blocked acceptance
  point 4 (the QR code in the setup note).

**Settings rows** test: 111 checks (was 86). **Apps catalogue**: 8 checks. `check-all` is at 16
stages.

## 0.6.33

HDMI inputs, taken from the direction the Samsung original went in 0.7.0 — and a
test that misses nothing any more.

**Inputs** (Settings → Inputs) lists the television's HDMI ports with their state:
`Active`, `Connected`, or `No device`. Pressing OK switches to the input and stays
on the page. The list is read every time the page opens, so a console plugged in
later appears without a restart.

The device layer is ours, not the original's: webOS has no single call that works
on every firmware, so `app/device.js` uses the same falling chain the neighbours
use — `apiadapter/tv switchInput`, then `eim/getInputStatus` and a launch with the
input's app id, then `utp/extinputs open`. The list comes from
`eim/getAllInputStatus`. What the television does not report is an error with a
reason and a "Try again", never an empty page that looks like "you have no inputs".

**Rows.** The inputs page is a picker like every other selection row. The rows test
now knows the page, so a settings page that changes shape without the test saying
so turns the run red.

**First version with inputs.** Nothing here needs root or Glasshouse: the input
list and the switch run over the television's own services. The Home takeover is
still open (issue #5) — this release does not touch it.

## 0.6.32

The four points from testing on the TV, plus a measurement bug the checks had.

Up and down in an open list now pick the answers. Before, the answers pushed the
rows below them apart, so "down" left the list at once and landed on the next
question - that is what made selecting feel wrong.

Without a place the weather cannot show anything, so "Off" is the only valid
answer until a place is set; the page says why, and picking anything else leads
into the place step instead of switching on a line that stays empty.

The place was unusable: it was a text field, and the television has no keyboard.
It is a list of the places the hub knows now (up/down and OK), with the hint that
a new place is added in the hub in the browser. While building it the bench found
a real crash - the place page had no entry in FILLS, so opening it threw a
TypeError.

The QR code in the setup note stood over the text on the left; it sits on the
right now, with the address underneath.

The layout report measured against #scene, the small preview box on the home
screen, instead of the stage. That made it report "Ort" at 1150 while the row sat
at 784 in the picture - every "does not fit" of the last rounds was measured
against the wrong box. It measures against the stage now.

test-picker was rebuilt on a straight promise chain: the nested callbacks had
lost a bracket and hung the whole run without a message. It waits for the page
instead of a fixed 4.2 s, which was the intermittent "CleanFrameDebug is not
defined". 20/20.
