# TierZero

A Discord bot you host yourself, with a web dashboard for configuring it. The
features that other bots put behind a subscription are included.

Every server the bot is in is configured from the dashboard. Turning a feature
on or off, or hiding an individual command from members, takes effect
immediately and does not require restarting anything or editing a file.

## Status

In development, and complete enough to run. Every feature below is built and
configurable from the dashboard. It has not been through a tagged release yet,
so expect the occasional rough edge and read `docs/architecture.md` before
depending on internals.

## Requirements

- Docker, or Node 20 and pnpm if you would rather run it from source
- A Discord application, which [docs/install.md](docs/install.md) walks you through creating

## Running it

```
git clone https://github.com/OWNER/tier0.git
cd tier0
cp .env.example .env
mkdir -p data
docker compose up -d
```

Fill in your Discord credentials in `.env` first. Open http://localhost:8080
and sign in; the first account to do so owns the install.

Full instructions, including how to create the Discord application, are in
[docs/install.md](docs/install.md).

## Running from source

```
pnpm install
pnpm db:migrate
pnpm dev
```

## Features

Each of these is a module. Turn any of them on or off per server, at any time,
without restarting anything. Individual commands can be hidden or restricted to
particular roles and channels the same way.

- **Moderation** - warn, timeout, kick, ban and temporary ban, with a case
  history, a mod log, and role hierarchy respected on every action
- **Automod** - invite and link filters with allowlists, capital letters,
  repeated text, mention limits, banned words and rate limiting, each with its
  own action and exemptions
- **Welcome messages** - greetings and farewells, with placeholders, optional
  direct messages, and roles assigned on join
- **Role menus** - self-service roles from buttons, optionally exclusive
- **Tickets** - a panel members press to open a private channel with your
  support team, with transcripts and auto-close
- **Audit logging** - message edits and deletions, joins, departures, nickname
  and role changes, channels, roles and bans, each switchable
- **Leveling** - experience for activity, role rewards, multipliers and a
  leaderboard
- **Utility** - server and member information commands

## Licence

AGPL-3.0-or-later. You can run, modify and redistribute this freely. If you
offer a modified version to other people over a network, you have to publish
your changes under the same licence.
