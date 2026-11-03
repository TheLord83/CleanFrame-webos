## 0.6.30

"Run setup again" pushed a screen that does not exist under that id (`msg` instead of
`message`), so the entry still did nothing visible. It now opens the hub's setup notice.
Removed a copy of the old picker label as well.

## 0.6.29

Three findings from testing on the TV.

The collapsed rows of the weather page showed the current value where the
question belongs - "Right edge" stood under the heading and then again as the
answer, and with another position "Normal" appeared twice. The question now sits
in the row, the value stays where it was.

"Run setup again" reloaded the launcher, which changed nothing on the TV: only
the browser side of the hub reads `onboarding.done`. The row now opens the hub's
setup on the next visit and says so in a dialog instead of reloading silently
into the same screen.

The picker rows carry the question in their label, so the arrow keys and the
screen reader have a name for the row; test-picker checks that four questions
appear once each and that no two rows show the same value.
