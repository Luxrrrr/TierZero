# TierZero

A Discord bot you host yourself, with a web dashboard to configure it.

The features other bots charge a subscription for are all here. Moderation,
automod, tickets, logging, leveling, the lot. There is no premium tier and
there is never going to be one.

You run it on your own machine, so your server's data stays on your own
machine.

## Status

Works. Not released.

Everything listed below is built and configurable from the dashboard, and it
has been running against a real server. There is no tagged version yet, so
things may still move around. If you are going to build against the internals,
read `docs/architecture.md` first.

## Requirements

A machine that stays on and Docker. A Raspberry Pi is plenty.

If you would rather run it from source you need Node 20 and pnpm instead.

You also need your own Discord application. That part trips people up more
than the install does, so [docs/install.md](docs/install.md) walks through it
screen by screen.

## Running it

```
git clone https://github.com/Luxrrrr/TierZero.git
cd TierZero
cp .env.example .env
mkdir -p data
docker compose up -d
```

Fill in your Discord credentials in `.env` before you start it. Then open
http://localhost:8080 and sign in. Whoever signs in first owns the install.

The [install guide](docs/install.md) has the whole thing in detail, including
the two privileged intents the bot will not start without.

## Running from source

```
pnpm install
pnpm db:migrate
pnpm dev
```

## Features

Every feature is a module, and every module is off until you turn it on. You
can switch one on or off per server whenever you like and it takes effect
straight away. Nothing needs restarting. Individual commands can be hidden or
locked to particular roles and channels the same way.

The dashboard gives each server an overview of every feature and its state, a
page per feature for its settings, one page listing every command on the
server, and a moderation area for your staff.

- **Moderation** — warn, timeout, kick, ban, temporary ban. Every action gets
  a numbered case, and role hierarchy is checked before anything is attempted.
- **Moderation dashboard** — member records with staff notes, warn, timeout,
  kick and ban from a member's profile, an action log you can export,
  statistics including what automod did, and an audit trail of what staff
  changed. Access is a list you control per server, separate from Manage
  Server. Mistaken warns and timeouts can be taken off a record without losing
  the history. Moderation and Automod settings sit in the same area. Staff can
  also act from Discord's right-click menu on a member or a message.
- **Automod** — invites, links, capitals, repeated text, mention limits,
  banned words, rate limiting. Seven rules, each with its own action and its
  own exemptions, all off by default.
- **Tickets** — a button members press to open a private channel with your
  staff. Transcripts and auto-close if you want them.
- **Welcome messages** — greetings, farewells, roles on join.
- **Role menus** — members pick their own roles from buttons.
- **Audit logging** — edits, deletions, joins, departures, nickname and role
  changes, channels, roles, bans. Twelve categories, each with its own switch.
- **Leveling** — experience for taking part, role rewards, a leaderboard. No
  generated image cards, on purpose.
- **News and patch notes** — posts new items from RSS feeds and Steam patch
  notes, as plain embeds with the game's logo. For sources you cannot follow
  with Discord's own Follow button.
- **Utility** — server and member info.

[docs/features.md](docs/features.md) goes through what each one actually does,
including the bits you would not guess from the settings screen.

## License

AGPL-3.0-or-later. Run it, change it, pass it on. The one condition is that if
you offer a modified version to other people over a network, you publish your
changes under the same license.
