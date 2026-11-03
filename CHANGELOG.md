## 0.6.31

Working through the list from testing on the TV.

Without the value strip the top of the home screen led nowhere: from the tiles
"up" did nothing, and the tool row could only be reached with "down" from below.
"Up" now enters the tools as well, and from the tiles it goes there directly.

The weather page grew the answers of the first question as a list that pushed the
rows below it: choosing the next answer moved to the next question instead of the
next answer. Rows and answers are one page per picker now; the card opens upward
when there is no room below, so the fifth row stays in the picture (36 px air).

Two things were missing on the weather page at all: a switch to turn it on again
("Off" as the first answer) and the place. The place opens a small text dialog and
hands the name to the hub, the same call the browser page uses.

"Run setup again" now shows a QR code to the hub instead of describing a screen
the television cannot show; the matrix comes from tools/make-qr.py (checked with a
decoder). Choosing a language still reloads: the texts are built at startup.
