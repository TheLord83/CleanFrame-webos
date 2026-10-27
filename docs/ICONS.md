# Icon library

The launcher and the configuration interface share one icon set:
`app/assets/icons/*.svg` (24×24, monochrome) and the catalogue
`app/assets/icons.json`, which groups them for the picker.

## Sources

| Source | Licence | Used for |
| --- | --- | --- |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | CC0 1.0 | PlayStation, Steam, Epic Games, Twitch, Crunchyroll, Paramount+, Netflix, YouTube, Disney+, Prime Video, Apple TV, Apple Music, Spotify, Stremio, Tubi, Max |
| [Custom Brand Icons](https://github.com/elax46/custom-brand-icons) | MIT | ARD, ZDF, ZDFneo, ZDFinfo, 3sat, ARTE, KiKA, RTL, RTLzwei, ProSieben, Sat.1, waipu.tv, WOW, Xbox, Nintendo Switch |
| Original drawings (this repository) | MIT | Device marks: console, HDMI, PC, laptop, Blu-ray, receiver, satellite, camera, soundbar, streaming stick, NAS, website |

Two collections were left out on purpose: `tv-logo/tv-logos` and `cytec/tvlogos` carry no licence,
so their artwork cannot be redistributed. Every file is recorded in
`app/assets/icons/SOURCES.json` with source URL and licence. Trademarks remain with
their owners; the marks only label the service the user chooses.

## Adding an icon

1. Drop the SVG into `app/assets/icons/` (`viewBox` required, paths filled white).
2. Add an entry to `app/assets/icons.json` under the right group with `key`, `de`, `en`.
3. Record source and licence in `app/assets/icons/SOURCES.json`.
4. Check everything:

```sh
python3 tools/check-icons.py
```

It verifies the XML, the `viewBox` and that every icon renders: headless Chrome
loads all SVGs and the page title reports `OK <n>`. It also writes
`app/assets/icons-preview.html` as a contact sheet.

## Where the icons appear

The web interface on port 8484 shows a picker for every home tile, served from `/api/icons` and
`/icons/<key>.svg`.

In the launcher a home entry may carry `icon: "<key>"` or a full URL. The catalogue under
"All apps" keeps the original app icon and name.
