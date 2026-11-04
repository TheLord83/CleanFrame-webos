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
