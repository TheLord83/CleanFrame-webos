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
