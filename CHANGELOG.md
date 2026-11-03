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
