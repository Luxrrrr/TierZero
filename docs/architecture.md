# Architecture

## Premise

Every decision here answers to five constraints, in order of precedence:

1. A server owner with no development background configures everything from the
   dashboard. Editing code is a path for advanced users, never a requirement.
2. Any feature, and any individual command, can be turned on or off per server,
   at any time, without a restart.
3. The project runs at zero cost. No paid infrastructure in the default install.
4. Setup instructions target a competent adult, not a developer.
5. The repository reads as the work of a professional developer throughout.

Constraints 1 and 2 are the ones with architectural teeth. They rule out the
shape most hobby bots take, where features are wired directly into a monolith
and configuration lives in a JSON file the operator edits by hand.

## Stack

| Area | Decision | Reasoning |
| --- | --- | --- |
| Language | TypeScript | Used for both processes. A module's settings schema is defined once and consumed by the bot at runtime and the dashboard at render time, which is only cheap if both speak the same type system. |
| Bot library | discord.js v14 | Largest ecosystem and contributor pool. Contributors arrive already knowing it. |
| Dashboard | Next.js | Auth, API routes and UI in one deployable. One fewer service in the compose file. |
| Auth | Discord OAuth2 | The operator already has an account, and the token yields their guild list and permissions directly. |
| Database | SQLite via Prisma | One file on disk. No second container, no connection tuning, backup is a file copy. |
| Repository | pnpm workspaces | Two apps, three shared packages. No build orchestrator until build times justify one. |
| Bot to dashboard | Internal HTTP | An authenticated control API on the private network, rather than adding Redis to an install meant to be one command. |

Prisma declares its provider in the schema rather than the connection string, so
supporting Postgres later means a second schema file or a generation step. That
is a known cost, accepted in exchange for SQLite being genuinely
zero-configuration on the install path that matters most.

## Process topology

Two long-running processes and one database file.

**tierzero-bot** holds the gateway connection, runs the module registry and
command router, owns the scheduler for timed actions, and serves the control API
bound to the internal network only.

**tierzero-web** serves the dashboard and setup wizard, owns database
migrations, reads live guild data through the control API, and is the only
process a reverse proxy is ever pointed at.

**./data/tier0.db** holds guild configuration, module settings, infractions,
tickets, levels, menus and dashboard sessions.

Splitting them is deliberate. A crash in the dashboard must not drop the gateway
connection, and the separation lets an advanced operator run the dashboard on a
public domain while the bot stays on a machine at home.

The control API is small, but it is not read-only: every write to a guild's
module settings or command overrides goes through it rather than through the
dashboard's own database access.

```
GET    /health
GET    /guilds                          guilds the bot is in
GET    /modules                         registry descriptions and schemas
GET    /guilds/:id/channels             live channel list for pickers
GET    /guilds/:id/roles                live role list, with assignability
GET    /guilds/:id/modules              every module, this guild's enabled flag and resolved settings
PATCH  /guilds/:id/modules/:moduleId    { enabled?, settings? }
PATCH  /guilds/:id/commands/:name       { enabled?, allowRoles?, denyChannels? }
POST   /guilds/:id/reload               re-read config, resync commands
```

Every request carries a shared secret from the environment, and the server
binds to loopback by default (`CONTROL_HOST` widens that for the case where
the dashboard runs on a separate machine).

The bot owns module settings; the dashboard is a client of this API rather
than a second writer to the database. The reason is atomicity: persisting a
settings change and refreshing the running bot have to happen as one step, or
the database and the live bot can end up disagreeing with nothing to notice
it. A `PATCH` handler validates the new settings against the module's schema,
upserts the row, invalidates the in-memory cache, schedules a command resync,
and fires whichever of `onEnable` / `onDisable` / `onSettingsChange` applies,
all before the response is sent. If the dashboard wrote to the database
directly, at least one of those steps would have to happen out of band, which
is exactly the gap where a saved setting stops matching what the bot is
actually doing.

## The module contract

This is the load-bearing idea. A module declares its settings as a schema, and
each field carries both a runtime validator and the metadata the dashboard needs
to render a control for it. The dashboard has one generic form renderer that
walks the schema, so no module ships dashboard code.

```ts
export default defineModule({
  id: "leveling",
  name: "Leveling",
  summary: "Grants XP for activity and assigns roles at thresholds.",

  settings: s.object({
    xpPerMessage: s.integer({ min: 1, max: 100, default: 15 }),
    cooldown:     s.duration({ default: "60s" }),
    announceIn:   s.channel({ types: ["text"], optional: true }),
    rewards:      s.array(s.object({ level: s.integer({ min: 1 }), role: s.role() })),
  }),

  commands: [rank, leaderboard],
  events:   { messageCreate: awardXp },
  requires: ["ManageRoles"],
});
```

`s.role()` is simultaneously a validator, a TypeScript type, and an instruction
to render a role picker populated from that guild's live role list. Adding a
module means writing one folder; its settings page appears on its own.

The alternative, where each feature ships a bespoke settings page, works fine
for the first three features and becomes the reason the project stalls at the
twelfth. A schema-driven renderer makes the dashboard requirement cheaper per
feature rather than more expensive.

Three lifecycle hooks, all optional: `onEnable`, `onDisable`, and
`onSettingsChange`. Hot reload is not a nice-to-have; constraint 2 requires it.

See `docs/modules.md` for the full reference.

## Configuration and storage

One rule: **secrets in the environment, everything else in the database.** If a
dashboard user would ever plausibly want to change a value, it does not belong
in a file.

Settings are stored as JSON and validated against the module's current schema on
read. Missing keys take their defaults, which is what allows a module to add a
setting without a migration. A renamed setting leaves a stale key behind;
`GuildModule.version` exists for a per-module migration hook that is not written
yet.

The database file is shared, but it is not shared *access*: the dashboard never
writes a `GuildModule` or `CommandOverride` row itself. It reads live guild
data and posts changes through the control API described above, and the bot is
the only process that writes those tables. That keeps the validate-persist-
reload sequence inside one process instead of splitting it across two, which
is what makes the no-restart guarantee in constraint 2 actually hold under
concurrent writers rather than just under the dashboard's own click-through
testing.

## Command visibility

```
visible(guild) = commands of enabled modules
               - commands disabled in CommandOverride
```

That set is registered as **guild-scoped** commands, never global. Global
commands are cached by Discord for roughly an hour and are identical everywhere,
which makes per-server visibility impossible. Resyncing is debounced by five
seconds so an operator flipping several switches produces one registration call.

Role and channel restrictions layer on top. Where Discord's own
`default_member_permissions` can express a rule it is used, because that hides
the command in the client rather than rejecting it after the fact. Rules
Discord cannot express, such as allowing a command only in specific channels,
are stored on `CommandOverride.allowRoles` and `denyChannels` and enforced in
the interaction router before a command runs.

The rules are read on every invocation, so they are cached per guild alongside
module settings and dropped by the same invalidation. The write path clears
that cache itself rather than leaving each caller to remember, because a
restriction that appears to save and then does nothing until the next restart
is worse than one that cannot be set at all.

## Deferred work

Some actions have to happen later: lifting a temporary ban, closing a ticket
nobody has replied to. Those are rows in `ScheduledTask`, not timers.

A timer held in memory is lost on restart, and a lost unban means a member
stays banned indefinitely with nothing left to say why. The runner reads due
rows on a fixed tick, coarse because nothing here is time critical to the
second and a quiet instance should not be waking constantly to find nothing to
do. A row is deleted before its handler runs, so a handler that throws is not
retried forever on every tick afterwards.

Task kinds are namespaced by module, the same way component custom ids are, so
two modules can both schedule something called `expire` without reading each
other's work.

## Installation

Three documented paths. Hosting-provider templates are deferred until the
configuration surface stops moving.

**Docker Compose** is the primary path and what the README leads with. Two
files, one command, no token baked into anything.

**The first-run wizard** is the real answer to constraint 4. On first boot with
no credentials, the dashboard serves a wizard instead of the normal interface:
walk through creating the Discord application with screenshots of the exact
Developer Portal screens, accept and validate each credential against Discord's
API as it is entered, compute the permission integer from the selected modules
and generate the invite link, then connect and hand off.

The Developer Portal is where non-technical users actually fail, not the install
command, and it is the part no written guide survives for long because Discord
redesigns that interface periodically. Validating each credential when it is
pasted turns a failure mode of "the container restarts forever and the logs
mention an invalid token" into a red field with a sentence explaining the fix.

**From source** is documented in CONTRIBUTING rather than the user-facing
install guide, so the two audiences never read each other's instructions.

## Build order

Features are not built simultaneously. Each phase proves something the next
depends on.

**Phase 0** — skeleton. Module registry, schema primitives, generic form
renderer, OAuth and guild selection, control API, one trivial utility module.
Exit criterion: toggling a setting in the dashboard changes bot behaviour with
no restart.

**Phase 1** — reaction roles and welcome. The fastest route to a server that
actually uses this, and the right load to put on a new module contract.

**Phase 2** — moderation and automod. The highest-value area. Introduces the
infraction model, the mod log, and the scheduler that phase 3 also needs.

**Phase 3** — tickets and audit logging. Reuses phase 2's plumbing. Adds
transcript generation, the first feature that writes files rather than rows.

**Phase 4** — leveling and rank cards. Last on purpose despite being the most
famous paywalled feature: rank card rendering pulls in native image dependencies
that are awkward in a Docker image, and the XP write path is the only workload
heavy enough to stress SQLite.
