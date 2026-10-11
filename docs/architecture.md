# Architecture

## Premise

Every decision here answers to four constraints, in order of precedence:

1. A server owner with no development background configures everything from the
   dashboard. Editing code is a path for advanced users, never a requirement.
2. Any feature, and any individual command, can be turned on or off per server,
   at any time, without a restart.
3. The project runs at zero cost. No paid infrastructure in the default install.
4. Setup instructions target a competent adult, not a developer.

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
| Bot to dashboard | Internal HTTP | An authenticated control API on the private network. Adding Redis to an install that is supposed to be one command buys nothing here. |

Prisma puts the provider in the schema, not the connection string. Supporting
Postgres later therefore means a second schema file or a generation step. That
is a real cost and we are paying it knowingly, because it buys SQLite being
genuinely zero-configuration on the install path most people will take.

## Process topology

Two long-running processes and one database file.

**tierzero-bot** holds the gateway connection, runs the module registry and
command router, owns the scheduler for timed actions, and serves the control API
bound to the internal network only.

**tierzero-web** serves the dashboard and setup wizard, owns database
migrations, reads live guild data through the control API, and is the only
process a reverse proxy is ever pointed at.

**./data/tier0.db** holds guild configuration, module settings, infractions,
moderator notes, the moderation audit trail, the staff list, tickets, levels,
menus and dashboard sessions.

Splitting them is deliberate. A crash in the dashboard must not drop the gateway
connection, and the separation lets an advanced operator run the dashboard on a
public domain while the bot stays on a machine at home.

The control API is not read-only: every write to a guild's module settings or
command overrides goes through it, and so does every write to the moderation
records described under [Moderation dashboard](#moderation-dashboard). The
dashboard does not write those tables itself.

```
GET    /health
GET    /guilds                          guilds the bot is in
GET    /modules                         registry descriptions and schemas
GET    /guilds/:id/channels             live channel list for pickers, categories included
GET    /guilds/:id/roles                live role list, with assignability
GET    /guilds/:id/modules              every module, this guild's enabled flag and resolved settings
PATCH  /guilds/:id/modules/:moduleId    { enabled?, settings? }
GET    /guilds/:id/modules/:moduleId/rows/:path/status
                                        status line for each row of a list setting, where the module declares one
POST   /guilds/:id/modules/:moduleId/rows/:path/actions/:actionId
                                        { input? } runs a module's action on one row, such as publishing a role menu
PATCH  /guilds/:id/commands/:name       { enabled?, allowRoles?, denyChannels? }
POST   /guilds/:id/reload               re-read config, resync commands
*      /guilds/:id/mod/...              the moderation dashboard, listed below
```

Every request carries a shared secret from the environment, and the server
binds to loopback by default (`CONTROL_HOST` widens that for the case where
the dashboard runs on a separate machine).

The bot owns module settings. The dashboard is a client of this API, not a
second writer to the database. The reason is atomicity: persisting a
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
module means writing one folder. Its settings page appears on its own.

The alternative, where each feature ships a bespoke settings page, works fine
for the first three features and becomes the reason the project stalls at the
twelfth. A schema-driven renderer makes the dashboard requirement cheaper per
feature cheaper as the project grows, not dearer.

Three lifecycle hooks, all optional: `onEnable`, `onDisable`, and
`onSettingsChange`. Hot reload is not a nice-to-have. Constraint 2 requires it.

The quick setup is the same idea applied twice. A module tags a handful of
fields `guided`; the dashboard reduces the schema to those, and feeds the result
to the renderer it already had. The wizard is one component that knows nothing
about any particular module, which is why every feature gets a short setup path
for the cost of some metadata, and why one that tags nothing simply is not
offered rather than needing a special case.

See `docs/modules.md` for the full reference.

## Configuration and storage

One rule: **secrets in the environment, everything else in the database.** If a
dashboard user would ever plausibly want to change a value, it does not belong
in a file.

Settings are stored as JSON and validated against the module's current schema on
read. Missing keys fall back to their defaults, and that is what lets a module
add a setting without a migration. Rename one and the old key is left sitting
there. `GuildModule.version` exists so a per-module migration hook can clean
that up, but nobody has written the hook yet.

The database file is shared, but it is not shared *access*: the dashboard never
writes a `GuildModule` or `CommandOverride` row itself. It reads live guild
data and posts changes through the control API described above, and the bot is
the only process that writes those tables. That keeps the validate-persist-
reload sequence inside one process. Split across two, the no-restart guarantee
in constraint 2 holds while you click through the dashboard yourself and stops
holding the moment anything else writes at the same time.

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
the command in the client instead of refusing it after somebody runs it. Rules
Discord cannot express, such as allowing a command only in specific channels,
are stored on `CommandOverride.allowRoles` and `denyChannels` and enforced in
the interaction router before a command runs.

The rules are read on every invocation, so they are cached per guild alongside
module settings and dropped by the same invalidation. The write path clears
that cache itself. Leaving each caller to remember would eventually produce a
restriction that saves, reports success, and quietly does nothing until the
next restart, which is worse than not being able to set one at all.

## Moderation dashboard

The staff-facing area at `/guilds/:id/mod` follows the same split as the rest of
the project: the bot owns the data, the dashboard is a client. What differs is
that it has users with different rights inside one server, so most of this
section is about where each check lives. User-facing behaviour is in
`docs/features.md`.

### Data

Four tables carry it, plus a counter column on `Guild`, all in
`packages/db/prisma/schema.prisma`.

| Table | Holds |
| --- | --- |
| `Infraction` | The cases. Gained `caseNumber`, `voidedAt`, `voidedBy` and `voidReason`. |
| `ModNote` | Staff notes on a member. Soft-deleted with `deletedAt` and `deletedBy`. |
| `ModAudit` | One row per change made through the dashboard, with JSON `before` and `after` snapshots where they apply. |
| `StaffMember` | Who may use the area in a guild, and at which level (`admin` or `mod`). Keyed on guild and user. |

The instance owner is staff in every guild the bot is in and is never stored in
`StaffMember`. The owner is a property of the install, set by the first sign-in
or `INSTANCE_OWNER_ID`, not of a guild. `StaffMember` therefore only ever holds
`admin` and `mod`. The access check reads only those two values, so a stored
row can never make anyone an owner: any other value grants nothing. The staff
list on the Access tab shows such a damaged row as `mod`.

Two migrations ship with it. `20261010120000_mod_dashboard` creates the three
new tables and rebuilds `Infraction`, the way Prisma redefines a table on SQLite.
Case numbers used to be a row's rank within its guild, computed on read. The
migration writes that rank into the new column, so every case keeps the number it
had. Rows that existed before carry no removal data.
`20261010150000_case_counter` adds `Guild.caseCounter` and backfills it with the
highest case number in use per guild.

### Who writes what

The dashboard writes none of these tables. Its pages read through
`apps/web/lib/mod-api.ts`, which calls the control API, and every change goes
through the proxy route `app/api/guilds/[id]/mod/[...path]/route.ts`. There is
one direct database read: `lib/mod-access.ts` looks up the signed-in user's
Discord account and their `StaffMember` row to decide what they may open.

For a write, the proxy does these things in order, and refuses at the first that
fails.

1. **Origin.** `isSameOriginWrite` in `lib/mod-proxy.ts`. A `GET` or `HEAD`
   passes. Anything else needs `Sec-Fetch-Site: same-origin` when the browser
   sends it, and an `Origin` header whose host equals the request's `Host` or the
   first value of `X-Forwarded-Host`. The session cookie goes with any request a
   browser makes to the dashboard's address, so without this a page on another
   site could post as whoever is signed in. It is why a reverse proxy must pass
   the host through; see `docs/install.md`.
2. **Path allowlist.** `modProxyPermission` maps method and path to a
   permission, or to nothing, which is a 404 that is never forwarded. Only the
   roots `members`, `notes`, `infractions`, `audit`, `stats`, `staff`,
   `member-search` and `actions` are served, and an empty, `.` or `..` segment is refused.
3. **Role.** `requireStaff(guildId, permission)` resolves the session to a
   Discord user ID and a level, and checks `can(level, permission)`. A `401`
   means not signed in and a `403` means no access or too low a level.
4. **Body.** At most 32 KiB, a JSON object. Whatever `actor` the browser put in
   it is discarded and replaced with the user ID, name and level from the
   session.
5. **Forward.** `modRequest` in `lib/control-api.ts`, with a 15 second timeout so
   a bot stuck on a slow Discord call cannot hold a page open.

The bot then does its own check. `actorOf` in `control/mod/index.ts` validates
the shape of the actor, and each handler calls `can`, `canVoidAction`,
`canEditNote` or `canDeleteNote` before it does anything. The control API is
reachable only with the shared secret, so an actor in a request is as trustworthy
as the dashboard that sent it. Nothing a browser sends can name itself an owner.

Settings are the exception to the staff rule. The Moderation area also hosts the
settings of the modules that declare `area: "moderation"` (see
`docs/modules.md`), under the Settings tab at `/guilds/:id/mod/settings`. The
layout above it admits listed staff and anyone with Manage Server, so that a
server manager who is not on the staff list can still reach the tab. What a
person may then open is decided page by page: the staff pages call
`requireStaff`, the settings routes call `requireGuildAccess`, and `modTabsFor`
only draws a tab the caller's access will open. A staff role does not grant
Manage Server, so staff without it get a 403 on the settings routes.

Reads are different. They carry no actor, so the bot cannot check a role on
them, and every read restriction lives in `modProxyPermission`: `audit.view` for
`/audit` and `/infractions/export`, `stats.view` for `/stats`, and `view` for
the rest. Taking an action, `POST members/:userId/actions`, needs `action.warn`
at the proxy, which is the lowest action permission; the bot then checks the
specific action against the role. Under `actions` the proxy serves only
`GET actions/context`. The server-rendered pages call `mod-api.ts` directly and
gate themselves with `requireStaff`. That is the reason the control API port
must never be published.

The bot's member profile endpoint returns the whole record, deleted note text and
the audit entries included. `lib/profile-redact.ts` trims it for the viewer's
level, both when the page renders and in the proxy when the browser reads the
profile through the API: without `audit.view` the audit entries are dropped, and
without `note.restore` a deleted note keeps its place and who deleted it but
loses its text.

### Control API routes

All of these are under `/guilds/:id/mod/`. A write carries `actor` in its JSON
body. `Page` replies take `page` (from 1) and `pageSize` (default 25, at most
100).

```
GET    members                    ?q=&filter=all|active|notes|recent&sort=recent|most|name|notes&page=&pageSize=
GET    members/:userId            profile: summary, infractions, notes, audit
GET    member-search              ?q=   guild members by name, up to 10, for pickers
GET    infractions                ?action=&moderatorId=&userId=&state=all|onrecord|inforce|expired|removed&source=all|manual|automod&q=&page=&pageSize=
GET    infractions/export         same filters as the list; text/csv, newest first, 5000 rows at most
GET    audit                      ?kind=&actorId=&targetUserId=&since=&until=&q=&page=&pageSize=
GET    stats                      ?days=   whole UTC days, 1 to 365, default 30
GET    staff                      the listed staff
GET    actions/context            ActionContextDto: the Moderation settings and limits the action form needs
POST   members/:userId/notes      { content }
POST   members/:userId/actions    { action, reason, durationMs, deleteDays }; ActionResult
PATCH  notes/:id                  { content }
DELETE notes/:id                  soft delete; with ?purge=1, removes the row and its audit rows
POST   notes/:id/restore
POST   infractions/:id/void       { reason }
POST   infractions/:id/restore
DELETE infractions/:id?purge=1    removes the row and its audit rows; without purge it is refused
PUT    staff/:userId              { role: "admin" | "mod" }
DELETE staff/:userId
```

On `infractions`, `state` is evaluated in the query so totals and paging stay
correct: `onrecord` is not removed, `removed` is removed, `inforce` is a
restriction that is not removed, still flagged active and not past its end, and
`expired` is the rest of the restrictions still on the record. The older
`status=active|voided` is still read when `state` is absent. `source=automod`
keeps entries whose action starts with `automod-` and `source=manual` keeps the
rest; an unrecognised value means no restriction, and the export honours it like
every other filter. `q` matches inside the reason, a case number when it is all
digits, and a user or moderator ID when it looks like a Discord ID. On `audit`, `since` and
`until` are whole UTC days and both are inclusive; `q` matches inside the
summary. Unknown query values are ignored and unmatched paths answer `404`.

### Shared rules

`packages/core/src/mod.ts` is the single definition of who may do what. It
imports neither discord.js nor the database, so the bot, the dashboard and the
tests all use the same file.

- `can(level, permission)` over a grant table per level. The Access tab builds
  its permission matrix by calling it, so the table on screen cannot drift from
  what the bot enforces. A new permission needs an entry in `GRANTS`, a row in
  `PERMISSION_GROUPS` in `app/guilds/[id]/mod/access/logic.ts`, and a proxy
  mapping if it gates a read.
- `canVoidAction(level, action)`. Anyone with `infraction.void` may remove
  `warn`, `timeout`, `automod-warn`, `automod-timeout` and `automod-delete`.
  Other actions need `infraction.void.any-action`, which only the owner has.
- `isInForce(entry)`. A restriction is in force when it is not removed, its
  stored `active` flag is set, its action is `timeout`, `automod-timeout` or
  `ban`, and it has no end time or the end time is in the future. The stored flag
  cannot answer alone: it is set on warns too and is not cleared when a timeout
  expires by itself. The actions page, the profile, the member summaries and the
  statistics all use this function, and the `inforce` and `expired` query
  filters mirror it.
- `permissionForAction(kind)` and `canTakeAction(level, kind)`, which map the
  six `ModActionKind` values to the `action.*` permissions. Clearing a timeout
  takes `action.timeout`. Moderators hold `action.warn` and `action.timeout`,
  admins add `action.kick`, `action.ban` and `action.unban`, and the owner has
  all of them. The Access tab's "Taking action" rows are built from the same
  function.
- `canEditNote` and `canDeleteNote`, which let an author change their own note.
- The reply shapes (`InfractionDto`, `NoteDto`, `AuditDto`, `StatsDto` and the
  rest) and `AUDIT_KIND_LABEL`.

### Actions

Warn, timeout, clearing a timeout, kick, ban and unban from the dashboard run
through `performAction` in `packages/modules/moderation/src/perform.ts`, the same
function behind the slash commands of those names. It does the checks, the
direct message, the Discord call, the infraction, the scheduled unban for a
temporary ban and the mod log post, in the order the commands always have. The
commands are thin wrappers that read their options and turn a refusal into the
ephemeral reply. The rules that need no Discord objects, such as reason and
duration limits and the wording of each refusal, are in `action-rules.ts` and
tested on their own.

`control/mod/actions.ts` checks `canTakeAction` first, then that the Moderation
feature is on for the server (its settings decide the mod log channel, the
direct message and the defaults, so the bot will not act without them), then
that the matching slash command has not been switched off on the Commands page
(clearing a timeout follows `/timeout`), then a limit of 20 actions a minute for
each staff member in each server. The context endpoint lists the switched-off
actions in `disabledActions` so the form can hide them. The infraction is the
record of the action, with the staff member as its moderator, and no audit entry
is written.

Some safeguards apply whichever way an action was asked for. Only Discord's own
"unknown member" or "unknown ban" answer counts as absence; any other failed
lookup refuses the action, because a member who has left skips the role
comparison. One action at a time may run against a member, so two bans at once
cannot both find no existing ban. A new ban cancels any pending scheduled unban
for that member, and the scheduled unban itself does nothing when the member's
newest open ban is permanent or has not yet ended. When Discord refuses a call,
its error code and message are logged with the guild and target ids.

The dashboard holds a few rules the commands do not, because the person acting
there was not checked by Discord on the way in. Nobody may act on themselves or
on the bot. Clearing a timeout needs the member to be timed out in Discord. A staff member who is
not in the server is refused, since their roles cannot be compared with the
target's; the instance owner is the exception, and is weighed as the server
owner would be, which still leaves the bot's own role position and the rule that
the server owner can never be actioned. The dashboard may warn someone who has
left, which only writes a record; the command still refuses that. The dashboard
never sends a direct message to someone who is not in the server, except on an
unban, whose target is confirmed as banned here: otherwise any Discord account
could be sent a staff member's free text. A refusal
answers `400` for bad input, `403` when it is not allowed, `404` when the member
is not in the server, `409` when they are already in the requested state, the
feature or command is off, or another action on them is still running, `429`
past the limit and `502` when Discord refuses the call or a lookup fails.

### Removal, restoring and purging

Removing a case sets `voidedAt`, `voidedBy` and `voidReason` and clears `active`.
The member list and summaries, the statistics totals and the moderation
module's `/history` and `/case` ignore rows with `voidedAt` set; the action log
and the profile show them, marked. The change and its
`ModAudit` row are written in one transaction, and the update is conditional
(`voidedAt: null` in the `where`), so two staff acting at once produce one
success and one `409` and never two audit entries. Edits to a note match on the
content that was read for the same reason.

Lifting a Discord timeout is a call to another service and cannot be rolled
back, so it runs after the commit. Its outcome is appended to the audit entry's
summary, and a failure there leaves the removal in place. It runs only for a
case whose action is `timeout` or `automod-timeout` and which was still active.
It is skipped when the timeout had already ended, when another unremoved timeout
against the same member is still in force, when the member has left, and when
Discord refuses.

Restoring clears the three removal columns and sets `active` from the `before`
snapshot of the most recent `infraction.void` entry for that case, except that a
case whose action is `timeout` always stays inactive. It makes no Discord call.

A purge deletes the row and every `ModAudit` row with that `infractionId` or
`noteId`, in one transaction, and records nothing. The row delete runs first and
its count decides the outcome, so a repeated purge answers `404`. SQLite may
retain deleted bytes in free pages until they are overwritten or the file is
vacuumed, so a purge is deletion from the database's point of view, not secure
erasure.

### Case numbers

`Infraction.caseNumber` is stored and unique per guild. The numbers come from
`Guild.caseCounter`, which only ever increases. `createInfraction` in
`@tier0/db` takes the next one with a single `UPDATE ... RETURNING`, which SQLite
serialises, so concurrent writers never receive the same number, and then
inserts the row. If the insert fails after the number is taken, that number is
skipped, which is harmless. Because the counter never decreases, neither a
removal nor a purge frees a number: a purge leaves a permanent gap, even when
the purged case had the highest number. The migration that added the counter
starts it at the highest number in use for each guild.

**Every writer of infractions must go through `createInfraction`.** A row
inserted some other way takes the column default of `0` and collides with the
next one. The moderation commands and automod both use it today.

### Audit entries

`writeAudit` in `control/mod/audit.ts` takes an optional transaction client so
the entry commits with the change it describes. The kinds are `note.add`,
`note.edit`, `note.delete`, `note.restore`, `infraction.void`,
`infraction.restore`, `staff.add`, `staff.update` and `staff.remove`. The actor's
name and level are stored on the row as they were at the time. An unknown kind
from a newer version still renders, labelled with its raw name. Every actor is
audited, the owner included. A purge is the one change that is not.

### Resolving names

A list can hold dozens of Discord IDs, and an ID Discord does not know costs a
round trip to learn that. `control/mod/names.ts` keeps a page from waiting on
that. Answers are remembered, for 10 minutes when a name was found and 30 when
it was not. A lookup already in flight is shared. A whole batch gets 1.5 seconds,
after which anything unresolved is shown by ID, and the lookups carry on in the
background so the next load has the names. The CSV export may start at most 300
new lookups and uses remembered names for the rest, so when the allowance runs
out it is the oldest cases that have blank names. The profile's join date and
account age lookups share the same 1.5 second ceiling.

### Statistics

`computeStats` in `control/mod/stats-calc.ts` is a pure function over arrays and
a clock, and is tested without a database. The handler reads the guild's whole
infraction and note history on each request, because the comparison period, the
repeat rate, "members with a record" and the in-force count all look past the
range. The comparison window is `[since - days, now - days)`: the same elapsed
stretch shifted back by the length of the range, so a part-finished current day
is set against an equally part-finished one. It is `null` when no action or
note, removed ones included, is older than `since`. Entries whose action starts
with `automod-` are totalled, grouped by the text before the first colon of
their reason (case folded, ten rules kept and the rest summed as `other`) and
compared over the same window; they, unbans and `timeout-clear` entries are left
out of the repeat rate. The in-force count uses `isInForce`.
The arithmetic is documented in comments where it is not obvious, and the
user-facing definitions are in `docs/features.md`.

### Sidebar state

The collapsible sidebar keeps its preference in the browser's `localStorage`,
not in the database, since it is a property of a device. An inline script in the
root layout reads it before first paint and sets an attribute on the document
element, which the stylesheet and `SidebarToggle` both read, so the page does
not flash at the wrong width. `lib/sidebar-state.ts` holds the parsing and the
Ctrl or Cmd plus B rule. The phone drawer ignores the preference.

### Limits

Notes are limited to 2,000 characters and a removal reason to 500. A member can
hold 200 undeleted notes. One staff member can add 30 notes a minute per guild;
the counter lives in memory and resets when the bot restarts, since it exists to
stop a runaway client rather than to meter anyone. Actions taken from the
dashboard are limited to 20 a minute per staff member per guild, in memory in
the same way.

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

**First run** currently claims ownership of the install and nothing more. The
first account to sign in is recorded as the owner, or `INSTANCE_OWNER_ID` fixes
it up front for an operator who would rather not race anyone to it.

The Developer Portal is where people without a development background actually
fail, not the install command, and `docs/install.md` walks through it step by
step for that reason. A guided wizard that validated each credential as it was
pasted would be better still, turning "the container restarts forever and the
logs mention an invalid token" into a field with a sentence explaining the fix.

That wizard is not built, and the reason is worth recording. Credentials live
in the environment, not the database. A wizard that collected them would have
to write a file the dashboard cannot reliably reload, and under Compose the
environment belongs to the container, not the application. Validating credentials the operator has already set is a
different, smaller feature and does not have that problem. That is the shape
this should take when somebody builds it.

**From source** lives in CONTRIBUTING, away from the user-facing install
guide, so neither audience trips over the other's instructions.

## Build order

Features are not built simultaneously. Each phase proves something the next
depends on.

**Phase 0** — skeleton. Module registry, schema primitives, generic form
renderer, OAuth and guild selection, control API, one trivial utility module.
Exit criterion: toggling a setting in the dashboard changes bot behavior with
no restart.

**Phase 1** — reaction roles and welcome. The fastest route to a server that
actually uses this, and the right load to put on a new module contract.

**Phase 2** — moderation and automod. The highest-value area. Introduces the
infraction model, the mod log, and the scheduler that phase 3 also needs.

**Phase 3** — tickets and audit logging. Reuses phase 2's plumbing. Adds
transcript generation, the first feature that writes files and not just rows.

**Phase 4** — leveling and rank cards. Last on purpose despite being the most
famous paywalled feature: rank card rendering pulls in native image dependencies
that are awkward in a Docker image, and the XP write path is the only workload
heavy enough to stress SQLite.
