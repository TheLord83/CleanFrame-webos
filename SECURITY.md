# Security

This is a hobby project that runs on a rooted TV, and it holds credentials: the Home
Assistant token and, if you use it, the MQTT password. Both live in
`/var/lib/cleanframe/config.json` on the TV with mode `0600`, and neither is sent back to
the browser (`GET /api/config` returns them empty and only says *set*).

## Reporting a problem

Do not open a public issue for a security problem. The repository's **Security** tab has
*Report a vulnerability*, which opens a private advisory
([direct link](https://github.com/TheLord83/CleanFrame-webos/security/advisories/new)). Describe:

- what you found, and what an attacker could do with it
- the version (`/api/health`, or **System** in the hub)
- how to reproduce it, if you can

Expect an answer within a few days. This is a one-person project, not a product with an
on-call rotation.

## What is in scope

- the hub (`web/`): its HTTP server, the API, the browser interface
- the launcher (`app/`): the app itself and what it does with the hub's API
- the install scripts (`tools/`), when they handle data they should not

## What is not in scope

Rooting a TV is out of scope. The exploit path in `tools/root/` is documented and unsupported, and
its security properties belong to the exploit, not to this project. Report those to the Homebrew
Channel or the exploit's author.

So is a TV on the open internet. The hub is built for a LAN: it has no user accounts, and requests
from the local machine are trusted by design, the same way Glasshouse does it. If you expose it,
put a reverse proxy with authentication in front, and think twice before you do.

LG's own services, the Homebrew Channel, Glasshouse and Home Assistant are somebody else's code, and
problems in them belong to their maintainers.

## What the project already does

- `config.json` and the SSAP client key are written with mode `0600`
- the API refuses requests with a foreign `Origin` header, and only accepts JSON bodies
- tokens and passwords are returned by neither `GET /api/config` nor `GET /api/backup`; both answer
  with an empty value and a `hasToken` / `hasPassword` flag
- the stored Home Assistant token is only sent to the stored Home Assistant URL, and a redirect is
  followed only inside that host
- TLS certificates are verified; `CF_HA_CA` adds a bundle, `CF_HA_TLS_INSECURE=1` is the documented
  opt-out for a self-signed certificate
- `/api/tv/info` reports model, webOS, firmware, board and memory, but not the serial number, the
  hardware ID or any file path
- the hub binds to the TV's LAN interface; nothing is sent anywhere else, there is no telemetry and
  no cloud
