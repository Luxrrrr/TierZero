# Architecture

How the pieces fit together and why. If you only want to write a module, [modules.md](modules.md) is the shorter read.

## Premise

Two things shape the design. Everything is configured from the dashboard, so a server owner with no development background never has to edit a file. And the project costs nothing to run, with no paid infrastructure in the default install.

The first rules out the shape most hobby bots take, where features are wired directly into a monolith and configuration lives in a JSON file the operator edits by hand. Settings live in the database and each feature and command can be switched per server without a restart, which is why most of what follows is built the way it is.

## Stack

| Area | Decision | Why |
| --- | --- | --- |
| Language | TypeScript | Used for both processes. A module's settings schema is defined once and used by the bot at runtime and the dashboard at render time, which is only cheap if both speak the same type system. |
| Bot library | discord.js v14 | Largest ecosystem and contributor pool. |
| Dashboard | Next.js | Auth, API routes and UI in one deployable, so one fewer service in the compose file. |
| Auth | Discord OAuth2 | The operator already has an account, and the token gives their server list and permissions directly. |
| Database | SQLite via Prisma | One file on disk. No second container, no connection tuning, and a backup is a file copy. |
| Repository | pnpm workspaces | Two apps and a few shared packages. No build orchestrator until build times justify one. |
| Bot to dashboard | Internal HTTP | An authenticated control API on the private network. Redis would add a service to an install that's meant to be one command. |

Prisma puts the provider in the schema and not in the connection string, so supporting Postgres later means a second schema file or a generation step. That's a real cost, and it's accepted because SQLite needs zero configuration on the install path most people will take.

## Processes

Two long-running processes and one database file.

- **bot** holds the gateway connection, runs the module registry and the command router, owns the scheduler for timed actions, and serves the control API on the internal network.
- **web** serves the dashboard, runs database migrations, reads live server data through the control API, and is the only process a reverse proxy should point at.
- **`data/tier0.db`** holds server configuration, module settings, moderation records, tickets, levels, menus and dashboard sessions.

They're separate on purpose. A crash in the dashboard shouldn't drop the gateway connection, and the split lets an advanced operator put the dashboard on a public domain while the bot stays on a machine at home.

### The control API

The bot owns module settings and the moderation records. The dashboard is a client of the control API and never writes those tables itself. The reason is atomicity. Saving a settings change and refreshing the running bot have to happen as one step, or the database and the live bot can disagree with nothing to notice. A settings `PATCH` validates against the module's schema, upserts the row, clears the in-memory cache, schedules a command resync, and runs whichever of `onEnable`, `onDisable` or `onSettingsChange` applies, all before the response is sent. If the dashboard wrote to the database directly, one of those steps would have to happen separately, and that gap is exactly where a saved setting stops matching what the bot is doing.

```
GET    /health
GET    /guilds                          servers the bot is in
GET    /modules                         registry descriptions and schemas
GET    /guilds/:id/channels             live channel list for pickers
GET    /guilds/:id/roles                live role list, with assignability
GET    /guilds/:id/modules              every module with its enabled flag and resolved settings
PATCH  /guilds/:id/modules/:moduleId    { enabled?, settings? }
GET    /guilds/:id/modules/:moduleId/rows/:path/status
POST   /guilds/:id/modules/:moduleId/rows/:path/actions/:actionId
PATCH  /guilds/:id/commands/:name       { enabled?, allowRoles?, denyChannels? }
POST   /guilds/:id/reload               re-read config, resync commands
*      /guilds/:id/mod/...              the moderation area
```

Every request carries a shared secret from the environment. The server binds to loopback by default, and `CONTROL_HOST` widens that for a dashboard on another machine. Under Docker Compose the port is never published.

## The module contract

This is the main idea. A module declares its settings as a schema, and each field carries a runtime validator and the metadata the dashboard needs to draw a control for it. The dashboard has one generic form renderer that walks the schema, so no module ships dashboard code.

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

`s.role()` is a validator, a TypeScript type, and an instruction to draw a role picker filled from that server's live roles. Adding a module means writing one folder, and its settings page appears on its own.

The alternative is a bespoke settings page per feature. That works for the first three features and becomes the reason the project stalls at the twelfth. A schema-driven renderer gets cheaper per feature as the project grows.

Modules have three optional lifecycle hooks: `onEnable`, `onDisable` and `onSettingsChange`. Hot reload isn't optional here, because features and commands are switched per server without a restart.

The quick setup uses the same idea. A module tags a few fields `guided`, the dashboard reduces the schema to those and feeds the result to the renderer it already has. One component knows nothing about any particular module, and a module that tags nothing gets no quick setup.

## Configuration and storage

Secrets go in the environment and everything else goes in the database. If a dashboard user would plausibly want to change a value, it doesn't belong in a file.

Settings are stored as JSON and validated against the module's current schema on every read. Missing keys fall back to their defaults, which is what lets a module add a setting without a migration. Renaming one leaves the old key behind. `GuildModule.version` exists so a per-module migration hook can clean that up, but the hook hasn't been written.

The database file is shared, but access isn't. The dashboard never writes a `GuildModule` or `CommandOverride` row. That keeps the validate, save and reload sequence inside one process. If two processes wrote, the no-restart guarantee would hold while you click through the dashboard and stop holding the moment something else wrote at the same time.

## Command visibility

```
visible(guild) = commands of enabled modules
               - commands disabled in CommandOverride
```

That set is registered as guild-scoped commands, never global ones. Discord caches global commands for about an hour and shows them identically everywhere, which makes per-server visibility impossible. Registration is debounced by five seconds, so flipping several switches produces one call. Slash commands and the right-click menu entries on members and messages share this namespace and these switches.

Role and channel restrictions sit on top. Where Discord's own `default_member_permissions` can express a rule, it's used, because that hides the command in the client and doesn't refuse it after someone runs it. Rules Discord can't express, such as allowing a command only in certain channels, are stored on `CommandOverride` and enforced in the interaction router before the command runs. Those rules are cached per guild with the module settings, and the write path clears the cache itself. Leaving that to each caller would eventually produce a restriction that saves, reports success, and does nothing until the next restart.

## The moderation area

The staff area at `/guilds/:id/mod` follows the same split: the bot owns the data and the dashboard is a client. The difference is that it has users with different rights inside one server, so most of the design is about where each check happens. [features.md](features.md) describes the behavior. The code is in `apps/bot/src/control/mod` and `apps/web/app/guilds/[id]/mod`.

### Who can do what

There are three levels. The install's owner is staff everywhere and is never stored in the database. Admins and moderators are rows in `StaffMember` that the owner creates. The access check reads only those two values, so a hand-edited row can never confer owner powers.

`packages/core/src/mod.ts` is the one definition of who may do what. It imports neither discord.js nor the database, so the bot, the dashboard and the tests all use the same file, and the permission matrix on the Access tab is built from it, so the table on screen can't drift from what the bot enforces.

### How a write reaches the bot

The browser never talks to the bot. Pages read through the control API on the server. Writes go through one proxy route, which refuses at the first of these that fails:

1. **Origin.** The request has to come from the dashboard's own page. The session cookie goes with any request a browser makes to the dashboard's address, so without this a page on another site could post as whoever is signed in. It compares the host in `Origin` with the request's `Host` or the first `X-Forwarded-Host`, which is why a reverse proxy has to pass the host through.
2. **Path.** Only known paths are served. Anything else is a 404 that's never forwarded.
3. **Role.** The session is resolved to a Discord user and a level, and that level has to hold the permission the path needs.
4. **Body.** At most 32 KiB, and the actor in it is replaced with the signed-in user. Nothing the browser sends can name itself an owner.
5. **Forward** to the bot, with a 15 second timeout so a slow Discord call can't hold a page open.

The bot then checks the role again in each handler. Reads carry no actor, so their restrictions live in the proxy's path map. That's why the control API port must never be published. Profiles are trimmed to the viewer's level, so a moderator never gets the audit trail or the text of deleted notes.

### Actions

Warn, timeout, kick, ban and unban from the dashboard, from a slash command and from the right-click menu all run through `performAction` in `packages/modules/moderation/src/perform.ts`. It does the checks, the direct message, the Discord call, the case, the scheduled unban for a temporary ban and the mod log post. The commands and the dashboard are thin wrappers around it, so they can't drift apart. Rules that need no Discord objects live in `action-rules.ts` and are tested on their own.

The dashboard enforces a few rules the commands don't, because Discord didn't check the person acting on the way in. Nobody can act on themselves or the bot. A staff member who isn't in the server is refused, since their roles can't be compared with the target's. And it never sends a direct message to someone who isn't in the server, apart from an unban, because otherwise a staff member's free text could be sent to any Discord account.

### Removing and purging

Removing a case or note is a soft delete: the row stays, marked with who removed it, when and why, and the change and its audit row are written in one transaction. Any staff member can remove a warn or timeout. An admin can restore it. Only the owner can purge, which deletes the row and every audit row about it, in one transaction, and writes nothing. SQLite may keep deleted bytes in free pages until they're overwritten, so a purge removes the record from the database but isn't secure erasure.

### Case numbers

Case numbers come from a counter on the guild that only goes up, taken with a single `UPDATE ... RETURNING`, which SQLite serializes, so concurrent writers never get the same number. A removal or purge never frees a number, so a purge leaves a permanent gap. Every writer of cases has to go through `createInfraction` in `@tier0/db`. A row inserted another way takes the column default of 0 and collides with the next one.

### Other details

Looking up names on Discord can take seconds for an ID it doesn't know, so each request gets a 1.5 second budget, answers are remembered, and the number of new lookups per request is capped. The statistics are computed by a pure function in `control/mod/stats-calc.ts` that's tested without a database. Dashboard actions are limited to 20 a minute per staff member per server, in memory.

## Deferred work

Some actions have to happen later, such as lifting a temporary ban or closing a ticket nobody has replied to. Those are rows in `ScheduledTask`, not timers. A timer in memory is lost on restart, and a lost unban leaves a member banned with nothing left to say why. The runner reads due rows on a fixed tick, which is coarse because nothing here is time-critical to the second. A row is deleted before its handler runs, so a handler that throws isn't retried on every tick forever. Task kinds are namespaced by module, so two modules can both schedule something called `expire`.

## Not built

**A setup wizard.** The hard part for people without a development background is the Discord Developer Portal, not the install command, which is why the install guides cover it step by step. A wizard that collected the credentials would have to write a file the dashboard can't reliably reload, because credentials live in the environment and under Compose the environment belongs to the container. Validating credentials the operator has already set is a smaller feature without that problem, and that's the shape this should take when someone builds it. For now, the first sign-in only claims ownership of the install.

**A settings migration hook** for renamed keys, described under Configuration and storage.
