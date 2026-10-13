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
PATCH  /guilds/:id/commands/:name       { enabled?, allowRoles?, denyChannels?, permissions?, ephemeral?, customReply? }
GET    /guilds/:id/messages              template folders and templates
POST   /guilds/:id/messages/folders      { name }
PATCH  /guilds/:id/messages/folders/:id  { name }
DELETE /guilds/:id/messages/folders/:id  templates inside move out, none deleted
POST   /guilds/:id/messages/templates    { name, folderId?, content, embeds, buttons, reactions }
PATCH  /guilds/:id/messages/templates/:id
DELETE /guilds/:id/messages/templates/:id
GET    /guilds/:id/messages/emojis       the server's custom emoji
POST   /guilds/:id/messages/send         { channelId, content, embeds, buttons, reactions, templateId?, ...send options }
POST   /guilds/:id/reload               re-read config, resync commands
*      /guilds/:id/mod/...              the moderation area
```

Requests carry a shared secret from the environment. The server binds to loopback unless `CONTROL_HOST` says otherwise, and Compose never publishes the port.

## Module contract

A module declares its settings as a schema. Each field has a runtime validator and the metadata the dashboard needs to draw a control, and one generic form renderer walks the schema, so modules ship no dashboard code. See [modules.md](modules.md).

`s.role()` is a validator, a TypeScript type and an instruction to draw a role picker from the server's live roles. A bespoke settings page per feature is fine for three features and a drag at twelve.

`s.message` is the field for anything the bot sends. It stores a `MessageBody` (the Messages page's shape), reads old plain strings as a message of that text, and the form draws it as a preview with an Edit message button that opens the shared `MessageEditorDialog`, the same dialog a command's reply uses. Modules send it through `ctx.send`, which calls `runtime/send-message.ts`: shared variables merged with the module's, a second validity check after filling, the same component and reaction handling as the Messages page send, and no exception back to the caller.

The text the bot sends on its own account (the router's refusals, the failure notice, the role button replies) belongs to no feature that can be switched off, so it lives in the built-in `system` module, declared `alwaysOn`. `GuildState` treats an `alwaysOn` module as enabled without a row, `applyModuleUpdate` stores it as enabled whatever the request says, and the control API refuses to disable it. The command router is `runtime/router.ts`, which takes the registry and the guild state so it can be exercised with fakes; its replies, and those of the button handlers and of the component dispatcher when a handler throws, go through `runtime/system-messages.ts`. The Bot messages page (`apps/web/app/guilds/[id]/bot-messages`) lists every `s.message` field of every module, and every command reply template, by walking the descriptors the control API already returns (`apps/web/lib/bot-messages.ts`). It saves through the same `PATCH /guilds/:id/modules/:moduleId` and `PATCH /guilds/:id/commands/:name` calls as the settings and Commands pages.

The quick setup reuses this. Fields tagged `guided` are reduced to a smaller schema and fed to the same renderer.

## Configuration and storage

Secrets go in the environment, everything else in the database. A value a dashboard user might want to change doesn't belong in a file.

Settings are JSON, validated against the module's current schema on every read. Missing keys fall back to defaults, so adding a setting needs no migration. A renamed key leaves the old one behind. `GuildModule.version` is there for a migration hook, which isn't written yet.

The dashboard never writes `GuildModule` or `CommandOverride`. Validate, save and reload stay in one process, which is what keeps the no-restart behavior reliable.

Message templates (`MessageTemplate`, `MessageFolder`) follow the same rule. They aren't module settings, so the Messages page has its own control API routes. The limits Discord puts on a message live in `packages/core/src/message.ts`, which the dashboard uses as you type and the bot uses again before saving or sending. Variables are filled in by the bot at send time, and the message is checked a second time afterwards because they can make it longer.

Buttons other than links, and every menu, get an id built from their place in the message (`tzmsg:b:0`, `tzmsg:s:1`). When one is used, the bot looks up the message in `MessageInteraction`, a snapshot of its components taken when it was sent, and runs the action stored there. Because of the snapshot, editing a template never changes a message that is already out. The handler is `runtime/message-components.ts`.

## Command visibility

Enabled modules' commands, minus anything switched off in `CommandOverride`, are registered per guild. Global commands are cached by Discord for about an hour and look the same everywhere, which breaks per-server visibility. Registration is debounced by five seconds. Slash commands and right-click entries share the namespace and the switches.

Where Discord's `default_member_permissions` can express a rule, it's used, since it hides the command in the client. The rest (a command allowed only in certain channels, say) is stored on `CommandOverride` and enforced in the interaction router. An owner can also replace the permission with a stricter one; the control API refuses to loosen a command that already has a default, because the command itself never checks the invoker. Reply visibility is forced on the first response by wrapping `reply` and `deferReply` in the router, and an owner's reply, a full message stored on `CommandOverride.responseBody`, reaches the handler as `ctx.customReply`, which a command calls with the values it knows and falls back from when it returns null. Reactions are added by the router, and only to a reply everyone can see. Those rules are cached per guild, and the write path clears the cache itself so a saved restriction can't silently do nothing until a restart.

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

Checks that hold for every origin: the actor has the Discord permission for the action or a staff role that covers it (`checkActorMayAct`), nobody acts on themselves, the bot or the server owner, and role hierarchy. The bot's own ability to act (`moderatable`, `kickable`, `bannable`) is checked before the DM, which for a kick or ban has to go out first. If the Discord call still fails after a DM was sent, the member is sent a correction. No DMs to non-members except on an unban, or a staff member's text could be sent to any Discord account.

The dashboard adds one more rule: a staff member who isn't in the server is refused, since their roles can't be compared with the target's.

A temporary ban is lifted by the `unban` scheduled task (`unban-task.ts`). The scheduler deletes a task's row before running it, so the handler schedules its own retry on failure (1, 5, 15, 60 minutes, then hourly until a day has passed). Discord's Unknown Ban (10026) counts as already lifted. The scheduler keeps a task whose module is off or whose guild isn't cached yet, pushing it back a minute at a time, and drops it after a week.

### Server logs

The `serverlog` module records what happens on a server into `ServerLogEntry` and, for messages, `LoggedMessage` with its `LoggedMessageEdit` rows. The kinds of event are one catalog in `packages/core/src/serverlog.ts`: categories, types and labels. The bot writes entries with those ids, the settings are one switch per category, and the dashboard builds its filters from the same list, so a new kind of event is one line there and one handler in `events.ts`.

Handlers write through `record()`, which checks that the category is on and the channel is not left out, trims long values, and prunes. Pruning runs from the write path at most once an hour per server, so a server with no traffic keeps what it has until someone deletes the logs. Who did something comes from `executorOf()`, which waits a moment and reads the server's audit log. It returns null without the View Audit Log permission. A kick and a departure look the same on the gateway, so a leave is checked against the audit log before it is recorded as a kick. Purges arrive as one `messageDeleteBulk` event instead of one delete per message.

Who deleted a message is decided in `deletion-source.ts`, in this order: a note from `noteDeletion()` in core, which a module calls just before it deletes (automod does; the note is in-process, taken once and dropped after about a minute); a matching line in the audit log (`MessageDelete`, same author, same channel when the line names one, executor the bot, the author or someone else); the author, since deleting your own message leaves no line; otherwise unknown. Discord folds a moderator's consecutive deletes into one line with a growing count, so each line remembers how many deletions it has been given. The result is stored on `LoggedMessage.deletedBy`, `deletedById` and `deletedByName`, and on the `message.delete` entry as its actor. A bulk delete records no deleter.

For messages the row holds the current text and the edit table holds each earlier version, up to 50 per message. Deletions set `deletedAt`. A message the log never saw is created on its first edit or deletion. The message handlers return what they saved, so the entry can show before and after without a second query.

Reads go through `GET mod/server-logs` (events) and `GET mod/messages` (saved messages). The proxy adds `viewer`, `owner` and `role` from the session and the bot narrows the channels to those the viewer can open, in the query itself (`server-log-filters.ts`, `message-filters.ts`). Entries that are not about a channel stay visible to every viewer. A moderator is refused unless `modsCanView` is set. Search runs as `LIKE` over the summary, the names and the details JSON, which is where edited and deleted text lives. `DELETE mod/server-logs` removes both tables for the server and writes an audit row. The earlier message log was a Moderation setting; migration `20261015120000_server_log` moves a server that had it on into this module with the same days, left-out channels and moderator access.

### Attached messages

Without the log, the moderation module keeps the latest messages of each member in memory (`recent-messages.ts`: 30 per member, 5,000 members, 72 hours, content cut at 4,000 characters). Nothing is written to disk until a moderator attaches one. `resolveEvidence` in `evidence.ts` turns the chosen channel and message ids into copies, from the buffer or by fetching, and refuses any message the acting staff member can't view in Discord, or that isn't by the target. The copies are stored as JSON in `Infraction.evidence` and are captured before the action runs, since a ban can delete the messages. The picker reads `GET members/:id/messages`. Reads carry no actor, so the proxy adds the signed-in `viewer` and `owner` to that query.

### Removing and purging

Removal is a soft delete. The row keeps who, when and why, and the change and its audit row are written in one transaction. Staff can remove warns and timeouts, admins can restore, and only the owner can purge, which deletes the row and every audit row about it and writes nothing. SQLite may keep the bytes in free pages until overwritten, so a purge isn't secure erasure.

### Editing a case

`PATCH infractions/:id` takes any of `reason`, `durationMs` and `evidence`, and leaves out what is missing. It sets `editedAt` and `editedBy` and writes one `infraction.edit` audit row with before and after snapshots, in the same transaction as the update. A moderator is limited to cases where `moderatorId` is their own, checked in the bot. Saving what is already there writes nothing.

A new length goes to Discord first (`edit-length.ts`: `member.timeout` for a timeout, cancelling and rescheduling the `unban` task for a ban), and the record is only updated if that succeeds. It needs the same role as taking the action, passes the dashboard's hierarchy guard, and counts from now. Attached messages already on the case keep the text they were saved with and only their flagged version can change; new ones are resolved the same way as when an action is taken. The audit list takes `infractionId` to show everything about one case.

Automod writes an `action.take` audit row for every case it records (`auditAutomodCase` in the moderation module), with the bot as actor and a role of `automod`. `automod` is a display role for audit rows only (`AuditActorRole`), never a `StaffRole`, so it grants nothing. The `actorId=automod` filter matches that role instead of an id. `backfillAutomodAudit` gives older cases their row on start and skips any case that already has one.

### Case numbers

A per-guild counter that only goes up, taken with one `UPDATE ... RETURNING` so concurrent writers never collide. Removal and purge never free a number. Everything that writes cases has to use `createInfraction` in `@tier0/db`. A row inserted another way gets 0 and collides.

### Other

Name lookups on Discord get a 1.5 second budget per request, with remembered answers and a cap on new lookups. Statistics are a pure function in `control/mod/stats-calc.ts`. Dashboard actions are limited to 20 a minute per staff member per server, in memory.

## Deferred work

Delayed actions (lifting a temporary ban, closing an idle ticket) are `ScheduledTask` rows, not timers, so a restart doesn't lose them. The runner polls on a coarse tick. A row is deleted before its handler runs, so a handler that throws isn't retried forever. Task kinds are namespaced by module.

## Not built

**Setup wizard.** The Developer Portal is where non-developers get stuck, so the install guides cover it. A wizard that collected credentials would have to write a file the dashboard can't reliably reload, since credentials live in the environment and Compose owns the environment. Validating credentials already set is smaller and doesn't have that problem. The first sign-in only claims ownership.

**Settings migration hook** for renamed keys. See Configuration and storage.
