# Architecture

Two goals drive the design: everything is configurable from the dashboard, and it costs nothing to run. Settings live in the database, and features and commands switch per server without a restart.

## Stack

| Area | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript | Both processes share the settings schema types. |
| Bot | discord.js v14 | |
| Dashboard | Next.js | Auth, API routes and UI in one deployable. |
| Auth | Discord OAuth2 | The token gives the user's server list and permissions. |
| Database | SQLite via Prisma | One file, backup is a copy. |
| Repo | pnpm workspaces | |
| Bot to dashboard | Internal HTTP | Authenticated control API. No Redis. |

Prisma declares the provider in the schema, not the connection string, so Postgres later means a second schema or a generation step. Accepted, because SQLite needs no setup.

## Processes

- **bot**: gateway connection, module registry, command router, scheduler, control API.
- **web**: dashboard, database migrations, reads live server data through the control API. The only thing a reverse proxy should point at.
- **`data/tier0.db`**: server config, module settings, moderation records, tickets, levels, menus, dashboard sessions.

A dashboard crash doesn't drop the gateway connection, and the dashboard can run on a public domain while the bot stays elsewhere.

### Control API

The bot owns module settings and the moderation records. The dashboard never writes those tables. A settings `PATCH` validates against the schema, upserts the row, clears the cache, schedules a command resync and runs `onEnable`, `onDisable` or `onSettingsChange`, all before it responds. A second writer would split that sequence, and a saved setting could stop matching what the bot is doing.

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

Requests carry a shared secret from the environment. The server binds to loopback unless `CONTROL_HOST` says otherwise, and Compose never publishes the port.

## Module contract

A module declares its settings as a schema. Each field has a runtime validator and the metadata the dashboard needs to draw a control, and one generic form renderer walks the schema, so modules ship no dashboard code. See [modules.md](modules.md).

`s.role()` is a validator, a TypeScript type and an instruction to draw a role picker from the server's live roles. A bespoke settings page per feature is fine for three features and a drag at twelve.

The quick setup reuses this. Fields tagged `guided` are reduced to a smaller schema and fed to the same renderer.

## Configuration and storage

Secrets go in the environment, everything else in the database. A value a dashboard user might want to change doesn't belong in a file.

Settings are JSON, validated against the module's current schema on every read. Missing keys fall back to defaults, so adding a setting needs no migration. A renamed key leaves the old one behind. `GuildModule.version` is there for a migration hook, which isn't written yet.

The dashboard never writes `GuildModule` or `CommandOverride`. Validate, save and reload stay in one process, which is what keeps the no-restart behavior reliable.

## Command visibility

Enabled modules' commands, minus anything switched off in `CommandOverride`, are registered per guild. Global commands are cached by Discord for about an hour and look the same everywhere, which breaks per-server visibility. Registration is debounced by five seconds. Slash commands and right-click entries share the namespace and the switches.

Where Discord's `default_member_permissions` can express a rule, it's used, since it hides the command in the client. The rest (a command allowed only in certain channels, say) is stored on `CommandOverride` and enforced in the interaction router. Those rules are cached per guild, and the write path clears the cache itself so a saved restriction can't silently do nothing until a restart.

## Moderation area

The bot owns the data and the dashboard is a client, same as elsewhere. The difference is that users have different rights in one server, so most of the design is about where each check runs. Code is in `apps/bot/src/control/mod` and `apps/web/app/guilds/[id]/mod`. Behavior is in [features.md](features.md).

### Permissions

Three levels. The install owner is staff everywhere and is never stored. Admins and moderators are `StaffMember` rows the owner creates. The access check only reads those two values, so a hand-edited row can't grant owner. `packages/core/src/mod.ts` holds every rule, imports neither discord.js nor the database, and also builds the matrix on the Access tab.

### How a write reaches the bot

Pages read through the control API on the server. Writes go through one proxy route that stops at the first failing check:

1. **Origin.** The host in `Origin` has to equal `Host` or the first `X-Forwarded-Host`. The session cookie goes with any request to the dashboard's address, so this stops other sites posting as the signed-in user. It's why a reverse proxy must pass the host through.
2. **Path.** Only known paths are served. Anything else is a 404 and isn't forwarded.
3. **Role.** The session resolves to a Discord user and level, which must hold the permission the path needs.
4. **Body.** 32 KiB at most. The `actor` in it is replaced with the signed-in user.
5. **Forward** with a 15 second timeout.

The bot checks the role again in each handler. Reads have no actor, so their restrictions live in the proxy's path map, which is why the control API port must never be published. Profiles are trimmed to the viewer's level, so a moderator doesn't get the audit trail or deleted note text.

### Actions

Dashboard, slash command and right-click actions all go through `performAction` in `packages/modules/moderation/src/perform.ts`: checks, DM, Discord call, case, scheduled unban, mod log post. The commands are thin wrappers. Rules that need no Discord objects are in `action-rules.ts` and tested alone.

The dashboard adds a few rules the commands don't need, because Discord didn't vet the actor. No acting on yourself or the bot. A staff member who isn't in the server is refused, since their roles can't be compared with the target's. No DMs to non-members except on an unban, or a staff member's text could be sent to any Discord account.

### Removing and purging

Removal is a soft delete. The row keeps who, when and why, and the change and its audit row are written in one transaction. Staff can remove warns and timeouts, admins can restore, and only the owner can purge, which deletes the row and every audit row about it and writes nothing. SQLite may keep the bytes in free pages until overwritten, so a purge isn't secure erasure.

### Case numbers

A per-guild counter that only goes up, taken with one `UPDATE ... RETURNING` so concurrent writers never collide. Removal and purge never free a number. Everything that writes cases has to use `createInfraction` in `@tier0/db`. A row inserted another way gets 0 and collides.

### Other

Name lookups on Discord get a 1.5 second budget per request, with remembered answers and a cap on new lookups. Statistics are a pure function in `control/mod/stats-calc.ts`. Dashboard actions are limited to 20 a minute per staff member per server, in memory.

## Deferred work

Delayed actions (lifting a temporary ban, closing an idle ticket) are `ScheduledTask` rows, not timers, so a restart doesn't lose them. The runner polls on a coarse tick. A row is deleted before its handler runs, so a handler that throws isn't retried forever. Task kinds are namespaced by module.

## Not built

**Setup wizard.** The Developer Portal is where non-developers get stuck, so the install guides cover it. A wizard that collected credentials would have to write a file the dashboard can't reliably reload, since credentials live in the environment and Compose owns the environment. Validating credentials already set is smaller and doesn't have that problem. The first sign-in only claims ownership.

**Settings migration hook** for renamed keys. See Configuration and storage.
