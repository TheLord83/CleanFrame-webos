# Asset sources and credits

What is in the build, where it came from, and who made it. This is the register the licence
files point at: `THIRD_PARTY_NOTICES.md` for the terms, this page for the provenance of every
file that does not come from this repository's own code.

The project's own code and drawings are MIT (`LICENSE`). Everything below keeps its own terms.

## Photographs: the fifteen launcher wallpapers

All fifteen come from [Unsplash](https://unsplash.com) and are used under the
[Unsplash License](https://unsplash.com/license): free to use, copy, modify and redistribute,
no permission needed, attribution appreciated. Photographers keep their rights and the project
claims no connection to them.

| # | Wallpaper | Runtime file | Photographer | Source |
| --- | --- | --- | --- | --- |
| 1 | Misty coast | `app/assets/wallpapers/misty.jpg` | Ganapathy Kumar | [photo page](https://unsplash.com/photos/n4VMQZIkgDg) |
| 2 | Quiet cove | `app/assets/wallpapers/cove.jpg` | Joshua Wordel | [photo page](https://unsplash.com/photos/1L_5PT7EKzU) |
| 3 | Forest mist | `app/assets/wallpapers/forest.jpg` | Dejan Zakic | [photo page](https://unsplash.com/photos/rr2EF3J5F2Y) |
| 4 | Mountain valley | `app/assets/wallpapers/valley.jpg` | Aniket Deole | [photo page](https://unsplash.com/photos/M6XC789HLe8) |
| 5 | Desert stars | `app/assets/wallpapers/night.jpg` | Mohammad Alizade | [photo page](https://unsplash.com/photos/4wzRuAb-KWs) |
| 6 | Blue peaks | `app/assets/wallpapers/peaks.jpg` | John Rodenn Castillo | [photo page](https://unsplash.com/photos/rQqWOHZ96OM) |
| 7 | Bridge at dusk | `app/assets/wallpapers/bridge.jpg` | Justin Wolff | [photo page](https://unsplash.com/photos/pbp_Ww2cewA) |
| 8 | Sunlit ridges | `app/assets/wallpapers/ridge.jpg` | Cristina Gottardi | [photo page](https://unsplash.com/photos/wndpWTiDuT0) |
| 9 | Golden hour | `app/assets/wallpapers/golden.jpg` | Karthik Sreenivas | [photo page](https://unsplash.com/photos/tmtkhWbgMu8) |
| 10 | Sunlit summits | `app/assets/wallpapers/summit.jpg` | Rudra Gupta | [photo page](https://unsplash.com/photos/PuTSzJJ-qyU) |
| 11 | Gold Coast dusk | `app/assets/wallpapers/goldcoast.jpg` | City of Gold Coast | [photo page](https://unsplash.com/photos/YiaGblobOGI) |
| 12 | Sydney Harbour | `app/assets/wallpapers/sydney.jpg` | Caleb | [photo page](https://unsplash.com/photos/JmuyB_LibRo) |
| 13 | Amber hills | `app/assets/wallpapers/amber.jpg` | Chris Barbalis | [photo page](https://unsplash.com/photos/vazZtmYFgFY) |
| 14 | Mint wave | `app/assets/wallpapers/mint.jpg` | MagicPattern | [photo page](https://unsplash.com/photos/87PP9Zd7MNo) |
| 15 | Alpine glow | `app/assets/wallpapers/alpine.jpg` | Cristina Gottardi | [photo page](https://unsplash.com/photos/CSpjU6hYo_0) |

The list above is generated from `app/assets/wallpapers/SOURCES.json`, which is the file the launcher
reads; this table is the readable copy. All fifteen photo pages were checked and
answered with HTTP 200 on 27 October 2026.

## Derived images

Each wallpaper ships as four files, all cropped from the credited photograph and all under the
same Unsplash terms:

| File | Size | What it is |
| --- | --- | --- |
| `<name>.jpg` | 1920 × 1080 | the wallpaper itself |
| `<name>-thumb.jpg` | 512 × 288 | the preview in the settings |
| `<name>-panel.jpg` | 320 × 180 | blurred backdrop behind a panel |
| `materials/<name>-field-blur.jpg`, `-clear.jpg`, `-frost.jpg`, `<name>-study-soft.jpg` | 1920 × 1080 | the four material styles (blur, clear, frost, study) |

Full-size originals stay outside the repository; the files above are the delivered sizes.
`app/assets/wallpapers/README.md` describes the directory, `app/assets/materials/` holds the
sixty material fields (fifteen wallpapers × four styles).

## Icons

| Material | Terms | Register |
| --- | --- | --- |
| Simple Icons service marks (46 entries) | CC0 | `app/assets/icons/SOURCES.json`, licence text beside the files |
| Disney+, ABC, SBS marks | [Custom Brand Icons](https://github.com/elax46/custom-brand-icons), MIT | `app/assets/icons/ADDITIONAL-SOURCES.json`, `CUSTOM-BRAND-ICONS-LICENSE.txt` |
| Art, apps, settings and home outlines | this project, MIT | drawn for CleanFrame |

Brand marks identify the services behind the tiles. The trademark owners keep their rights; the
project does not suggest endorsement or affiliation.

## Fonts

| Font | Terms | Where |
| --- | --- | --- |
| Manrope | SIL Open Font License 1.1 | `app/assets/manrope.woff2`, `manrope-OFL.txt` |
| Geist, Newsreader | SIL Open Font License 1.1 | `app/assets/fonts/`, licences beside the files, sources and hashes in `app/assets/fonts/SOURCES.json` |
| PP Neue Montreal, PP Mori, PP Pangram Sans | proprietary, optional | not in the repository; a local overlay needs the user's own licence |

## What is not in here

The wallpapers of Samsung's Art Mode are not part of this project and are not touched by it;
that is Samsung's artwork and Samsung's controls. LG's own artwork, app icons and system
resources are likewise not redistributed here.
