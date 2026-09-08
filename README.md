# TierZero

A Discord bot you host yourself, with a web dashboard for configuring it. The
features that other bots put behind a subscription are included.

Every server the bot is in is configured from the dashboard. Turning a feature
on or off, or hiding an individual command from members, takes effect
immediately and does not require restarting anything or editing a file.

## Status

Early development. The module runtime and the dashboard form renderer work; the
feature modules described below are not written yet. See `docs/architecture.md`
for the design and the planned build order.

## Requirements

- Docker, or Node 20 and pnpm if you would rather run it from source
- A Discord application, which the setup wizard walks you through creating

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

## Planned features

- Moderation and automod, with a case history and mod log
- Reaction roles and welcome messages
- Support tickets with transcripts, and server audit logging
- Leveling with configurable rank cards and role rewards

## Licence

AGPL-3.0-or-later. You can run, modify and redistribute this freely. If you
offer a modified version to other people over a network, you have to publish
your changes under the same licence.
