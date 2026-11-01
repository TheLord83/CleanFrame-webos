## 0.6.28

Screenshots with only one edge asked for came back squashed: `?width=1600` gave
1600x1080, because the height stayed at its default while the capture service
scales to exactly the numbers it is given. A single edge now derives the other
from the display ratio (1920x1080), so 1600 gives 1600x900 and 540 gives 960x540.
Sizes are clamped to 160..1920 and 90..1080.

The API test checks both directions; with the old behaviour it fails with
"(1600, 1080)".
