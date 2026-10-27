# Contributing

Issues and pull requests are welcome. Two things make a report useful here: which TV and which
webOS version, and what the screen said.

## Before you open an issue

- Read [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). It lists the failures that have actually
  happened, with the command that settles them.
- Run `tools/check-all.sh` if the problem is in this repository rather than on the TV. It needs
  node, python3 and Chrome, no TV.
- Put the numbers in the report: model, webOS version, launcher version, hub version. The hub shows
  them under **System**, and `GET /api/tv/info` returns them as JSON.

## Scope

In scope: the launcher, the hub, the build and install scripts, the documentation.

Out of scope: rooting a TV (that is the Homebrew Channel's guide), Glasshouse, Home Assistant, and
anything that only happens after editing the firmware.

## Pull requests

- Keep the change small enough to review in one sitting, and say what you measured afterwards.
- `tools/check-all.sh` has to stay green; a new behaviour needs a check in the stage it belongs to.
- The app runs on Chromium 79 and node 8.12 on the TV. `tools/check-node8.py` catches the usual
  traps (`new URL`, `mkdirSync({recursive})`, `readBigUInt64BE`).
- Documentation is English in `README.md` and the `docs/` pages, German in `README.de.md`. Both stay
  in step.
- Write commit messages that name the cause. "Fix strip" is not a message, "the rebuild key for a
  tile contained neither name nor icon" is.

## Licence

Contributions are MIT, like the rest of the port. By sending a pull request you agree that your
change can be published under that licence.
