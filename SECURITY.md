# Security

This is a hobby project that runs on a rooted TV, and it holds credentials: the Home
Assistant token and, if you use it, the MQTT password. Both live in
`/var/lib/cleanframe/config.json` on the TV with mode `0600`, and neither is sent back to
the browser (`GET /api/config` returns them empty and only says *set*).

## Reporting a problem

Do not open a public issue for a security problem. Write to **193955790+TheLord83@users.noreply.github.com** with:

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

- **rooting a TV.** The exploit path in `tools/root/` is documented, unsupported, and its
  security properties are the exploit's, not this project's. Report those to the Homebrew
  Channel or the exploit's author.
- **a TV on the open internet.** The hub is meant for a LAN: it has no user accounts, and
  requests from the local machine are trusted by design, the same way Glasshouse does it.
  Put it behind a reverse proxy with authentication if you expose it, and think twice
  before you do.
- LG's own services, the Homebrew Channel, Glasshouse, Home Assistant.

## What the project already does

- `config.json` and the SSAP client key are written with mode `0600`
- the API refuses requests with a foreign `Origin` header, and only accepts JSON bodies
- tokens and passwords are never returned by `GET /api/config`
- the hub binds to the TV's LAN interface; nothing is sent anywhere else, there is no
  telemetry and no cloud
