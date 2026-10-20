# Contributing

## Running it locally

You need Node 22+ and pnpm.

```
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

That starts the bot and the dashboard, which is at http://localhost:8080. Fill in `.env` first. You need your own Discord application for this (token, client ID, client secret) and a server you own to test in. [install.md](install.md) walks through creating one.

## Where things are

```
apps/bot             gateway connection, module runtime, control API
apps/web             dashboard and first-run sign-in
packages/core        module contract, settings schema and the message builder
packages/db          Prisma schema and client
packages/modules/*   feature modules
packages/shared/*    rules and shapes the bot, a module and the dashboard agree on
```

Start with `packages/core/src/schema.ts`. To add a feature, see [modules.md](modules.md). If a module seems to need its own dashboard page, the schema is probably missing a field type.

## Checks

`pnpm typecheck`, `pnpm lint` and `pnpm test` should all pass before you open a pull request.

Commit messages are a short imperative subject, with a body if the reason isn't obvious from the diff. `git log` has plenty of examples.

## Tests

`pnpm test` builds everything and runs Node's built-in runner. Each package has a `test` folder, and tests import the built output, not the source.

Node strips types without compiling, so a file under test can't use syntax that needs real compilation. Constructor parameter properties are the usual offender. Keep testable logic in files that don't import discord.js.

## Moderation records

Things that break if you miss them. The reasons are in [architecture.md](architecture.md).

- Make cases with `createInfraction` from `@tier0/db`, not `prisma.infraction.create`. It assigns the case number, and a row inserted another way collides with the next case.
- The slash commands and the dashboard share one code path for taking an action, `performAction` in `packages/modules/moderation/src/perform.ts`. A new action goes there so the two can't drift apart.
- Removed entries stay in the table with `voidedAt` set. Anything that lists or counts a member's record has to skip them, unless it's showing removals on purpose.
- What each role can do is decided in `packages/shared/moderation/src/mod.ts`. Add to the grant table there and don't check a role name in a page or handler.
- Changes made in the dashboard write a `ModAudit` row with `writeAudit`, in the same transaction as the change. Purging is the exception and writes nothing.

## Sample moderation data

To fill a server's moderation dashboard with made-up history, run this against your dev database:

```
DATABASE_URL=file:/absolute/path/to/data/tier0.db node packages/db/scripts/seed-mod-demo.mjs <guildId>
```

In PowerShell, set the variable first with `$env:DATABASE_URL = "file:C:/path/to/data/tier0.db"`. The server has to be in the database already, which happens when the bot joins it.

It adds about 60 cases over 45 days across 12 fake members and 4 fake moderators, plus notes, removed cases, audit entries and two staff members. Everything it writes starts with `[demo] ` or uses fake user IDs, so this removes it all and nothing else:

```
DATABASE_URL=file:/absolute/path/to/data/tier0.db node packages/db/scripts/seed-mod-demo.mjs <guildId> --remove
```

You see the data as the install's owner. The fake staff can't be signed in as, and people show as "User" plus the last four digits of their ID, since Discord doesn't know them.

## Releasing

The dashboard's Updates page compares the root `package.json` version with the latest GitHub release, so bump `version` there in the commit that is released, then tag and publish the release with the same number. The release notes are what the Updates page shows as the changelog, so write them for the people who run the bot.

The roadmap on that page is `apps/web/data/roadmap.json`. Installs read it from the `main` branch on GitHub, so editing it changes what everyone sees without a release. Each item needs a `title` and a `status` of `in-progress`, `planned` or `considering`, with an optional `description`.
