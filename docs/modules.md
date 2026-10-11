# Writing a module

A module is a directory under `packages/modules` that default-exports a call to
`defineModule`. Its settings page appears in the dashboard on its own. You
never write one.

Wiring a new module up takes three lines, all of them mechanical:

1. Add a project reference in the root `tsconfig.json` so `tsc -b` builds it.
2. Add it to the `dependencies` of `apps/bot/package.json` so the import
   resolves.
3. Import it in `apps/bot/src/index.ts` and pass it to `registry.register`.

Copy `packages/modules/utility` for the package manifest and tsconfig. It is
kept small and exists to be the example.

## The shape of a module

```ts
import { SlashCommandBuilder } from "discord.js";
import { defineModule, s } from "@tier0/core";

export default defineModule({
  id: "welcome",
  name: "Welcome messages",
  summary: "Greets new members and assigns them a starting role.",

  settings: s.object({
    channel: s.channel({ types: ["text"], label: "Post welcomes in" }),
    message: s.string({ multiline: true, max: 2000 }),
    autoRole: s.role({ label: "Role to assign", optional: true }),
  }),

  events: {
    async memberJoin(member, ctx) {
      const channel = member.guild.channels.cache.get(ctx.settings.channel);
      if (channel?.isTextBased()) {
        await channel.send(ctx.settings.message.replace("{user}", `<@${member.id}>`));
      }
    },
  },

  requires: ["ManageRoles"],
});
```

## Settings

The builders in `s` each produce a validator and the metadata the dashboard
needs to draw a control. That pairing is the point: there is one form renderer
in the dashboard, and it works for any schema, so no module ships UI code.

| Builder | Stored as | Dashboard control |
| --- | --- | --- |
| `s.string({ multiline, min, max })` | string | text input or textarea |
| `s.integer({ min, max })` | number | number input |
| `s.boolean()` | boolean | switch |
| `s.duration({ max })` | milliseconds | number input with a unit next to it |
| `s.channel({ types })` | snowflake | channel picker, filtered by type and grouped by category |
| `s.role()` | snowflake | role picker, with unassignable roles greyed out |
| `s.choice({ options })` | string | select |
| `s.emoji()` | string | text input accepting a unicode or `<:name:id>` emoji |
| `s.template({ placeholders })` | string | textarea with insertable placeholders and a preview |
| `s.array(field, { min, max })` | array | chips, tags or a list of removable rows, by item kind |
| `s.object({ ... })` | object | a card of its own at the top level, a subgroup below it |

Every builder takes `label`, `help` and `optional`. A field with a `default` is
used whenever stored settings do not carry that key, so a module can add a
setting later without a database migration.

Settings reach handlers already parsed. `ctx.settings` is typed from the schema,
so a handler never validates anything itself and never sees the raw JSON.

### Metadata the dashboard reads

Three further keys change nothing about parsing. Two of them exist so the
dashboard can be honest about a half-configured server; the third decides what
the quick setup asks about.

`essential: true` marks a setting the module cannot do anything without. Such a
field is nearly always `optional` as well, because the module has to load before
anyone can configure it; the pair says "this will parse, but the feature is
idle until it is filled in". The dashboard shows the module as needing setup
and names the fields that are still empty.

```ts
channel: s.channel({
  types: ["text"],
  optional: true,
  essential: true,
  label: "Log channel",
}),
```

`when: { field, equals }` points at a **sibling** in the same object and means
"this only applies when that one says so". Leave `equals` out and the condition
is met whenever the sibling holds anything. The dashboard disables the field
while the condition is unmet and explains why, built from the sibling's label,
so the `help` text should not repeat it. Naming a sibling that does not exist
fails the test suite rather than silently disabling the field forever.

```ts
action: s.choice({
  label: "What to do when it trips",
  options: [
    { value: "delete", label: "Delete the message" },
    { value: "timeout", label: "Delete the message and time the member out" },
  ],
  default: "delete",
}),
timeoutDuration: s.duration({
  label: "Timeout length",
  default: "10m",
  when: { field: "action", equals: "timeout" },
}),
```

`guided: true` marks a setting the quick setup asks about. The wizard walks a
reduced copy of the schema: the fields tagged here, plus every `essential` one,
which it asks whether or not it is tagged, and renders it through the same form
renderer as the full page. Tag the handful of settings someone has to decide
before the feature is any use, and leave the rest; the point of the short path
is that it is short. A module that tags nothing offers no quick setup, which is
a reasonable answer for one whose settings are all repeating rows.

```ts
modLogChannel: s.channel({
  types: ["text"],
  optional: true,
  guided: true,
  label: "Mod log channel",
}),
```

Two things follow from the wizard editing the module's whole settings object and
sending it back intact. Settings it does not draw keep the values they already
have, so tagging a field is not a decision about what the module stores. And a
tagged field whose `when` names a sibling pulls that sibling in as well, so the
wizard never shows a control greyed out with the switch that would enable it
left behind on the full page.

The bundles the quick setup offers (which modules it walks, and in what order)
live in `apps/web/lib/guided.ts`. That is the one place the dashboard names
modules directly, and a module missing from an install is dropped from a bundle
rather than breaking it.

### Groups that switch off

A top-level `s.object` becomes a card of its own. When the first field in that
object is a boolean named `enabled`, the dashboard lifts it out of the body and
draws it as a switch in the card header, dimming the rest of the group while it
is off. Nothing enforces the name, so a group that wants its first boolean to
stay in the body simply calls it something else.

```ts
transcript: s.object(
  {
    enabled: s.boolean({ label: "Save a transcript when a ticket closes", default: true }),
    channel: s.channel({ types: ["text"], optional: true, when: { field: "enabled", equals: true } }),
  },
  { label: "Transcripts" },
),
```

### Hosting settings inside an area

Every module gets a settings page of its own at `/guilds/:id/:moduleId`. A module
that belongs to a larger part of the dashboard can say so with `area`:

```ts
export default defineModule({
  id: "automod",
  category: "moderation",
  area: "moderation",
  // ...
});
```

The only area today is `moderation`. The settings are still drawn from the
schema by the same form, with the same validation and save bar; `area` changes
where that form sits. Moderation and automod are hosted under the Moderation
tabs, at `/guilds/:id/mod/settings` and `/guilds/:id/mod/settings/automod`, and
the old module pages redirect there. A module with an area is not listed again
under its category in the sidebar. Hosted settings need Manage Server, which a
staff role does not grant, so the Settings tab is shown to managers only.

Links to a module's settings go through `moduleHref` in
`apps/web/lib/module-href.ts`, which returns the hosted address when the module
declares an area. Do not build `/guilds/${id}/${module.id}` by hand.

## Status and actions on list rows

A setting that is a list of objects (feeds, role menus, reward tiers) is drawn
as one row per entry. A module can attach two things to those rows without any
dashboard code: a status line beside each one, and buttons that do something to
one. Both are declared under `rows`, keyed by the list's path in the schema
without indices.

```ts
rows: {
  "news.feeds": {
    async status({ ctx, rows }) {
      return rows.map((ref) => ({ tone: "ok", text: "Working" }));
    },
    actions: {
      send: {
        label: "Send latest posts",
        input: s.object({ count: s.integer({ label: "How many", min: 1, max: 10, default: 3 }) }),
        async run({ ctx, row, input }) {
          return { ok: true, message: "Sent 3 posts." };
        },
      },
    },
  },
},
```

`tone` is `ok`, `problem` or `idle`, and the text is what the row shows. An
action's `input` is an ordinary settings object, so the dashboard asks for it
with the same controls and the bot validates it the same way. The message that
`run` returns is shown to whoever pressed the button, so it should say what
happened, in words.

Both hooks work on the settings as last saved, never on a draft, which is why
the dashboard disables the buttons while there are unsaved changes. A row
reaches the hook as a `RowRef`: its indexed path (`patchNotes.destinations[0].games[1]`),
the row itself, and the object that holds the list, so a game can be read in the
context of the channel it sits under.

## Commands

Each command declares its own name, which must be unique across all modules.
The registry rejects a duplicate at startup, so two modules can never end up
fighting over one command at runtime.

Commands are registered per guild. The set is recalculated whenever a module is
toggled or an override changes, and registration is debounced so that an
operator clicking through several switches produces one API call.

### Right-click entries

A module can also add entries to Discord's right-click menu on members and on
messages with `contextCommands`. They share the command namespace, the Commands
page and the per-server switches with slash commands, so a name has to be unique
across both. Discord allows spaces and capitals in these names and at most five
of each kind per server.

```ts
contextCommands: [
  {
    name: "Warn member",
    description: "Warn a member from the right-click menu.",
    kind: "user", // or "message"
    build: () =>
      new ContextMenuCommandBuilder()
        .setName("Warn member")
        .setType(ApplicationCommandType.User)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setContexts(InteractionContextType.Guild),
    async run(interaction, ctx) {
      // interaction.targetUser, or interaction.targetMessage for a message entry
    },
  },
],
```

`setDefaultMemberPermissions` only decides who is shown the entry. It is not an
authorisation check, so `run` has to make its own, and anything that needs input
should open a modal and check again when it is submitted.

## Events

A module declares handlers for the events it cares about. Each is optional, and
handlers are only called for guilds where the module is switched on.

| Handler | Fires on |
| --- | --- |
| `messageCreate(message, ctx)` | a message in a guild, bots excluded |
| `messageDelete(message, ctx)` | a deletion, often with a partial message |
| `messageUpdate(before, after, ctx)` | an edit |
| `memberJoin(member, ctx)` | someone joins |
| `memberLeave(member, ctx)` | someone leaves or is removed |
| `memberUpdate(before, after, ctx)` | nickname, roles or timeout changed |
| `channelCreate(channel, ctx)` / `channelDelete` | a channel appears or goes |
| `roleCreate(role, ctx)` / `roleDelete` | a role appears or goes |
| `banAdd(ban, ctx)` / `banRemove(ban, ctx)` | a ban is placed or lifted |

Partials are enabled, so anything about an object the bot never cached arrives
with most fields null. Handle that, or your log fills up with `undefined`.

Every handler runs inside its own error boundary. A module that throws is
logged with its id and the others still receive the event.

## Buttons and modals

Components are addressed by custom id, which is namespaced the same way task
kinds are:

```ts
import { customId } from "@tier0/core";

new ButtonBuilder()
  .setCustomId(customId("tickets", "close", String(ticket.id)))
  .setLabel("Close");
```

```ts
components: {
  async close(interaction, { rest, ctx }) {
    // rest is "42", everything after the action
  },
},
modals: {
  async subject(interaction, { rest, ctx }) {},
},
```

The router splits the id, finds the module that owns it and hands the
interaction over, so two modules can both have a `confirm` button without
colliding. Always build ids with `customId`. Do not assemble one by hand.

## Deferred work

Anything that has to happen later goes through `ctx.tasks`, not a timer:

```ts
await ctx.tasks.schedule("unban", new Date(Date.now() + duration), { userId });
await ctx.tasks.cancel("unban", { userId });
```

```ts
tasks: {
  async unban(payload, ctx) {
    await ctx.guild.bans.remove(String(payload.userId));
  },
},
```

Rows outlive the process, so a restart between scheduling and running loses
nothing. `cancel` matches on a subset of the payload, so an action reversed by
hand can drop its pending reversal without knowing what else was recorded
alongside it.

## Lifecycle

All three hooks are optional.

- `onEnable(ctx)` runs when an operator switches the module on for a server.
- `onDisable(ctx)` runs when they switch it off. Remove anything the module
  created. Somebody may switch the module back on later.
- `onSettingsChange(ctx, previous)` runs after settings are saved. Use it for
  work that has to happen once and not on every command, such as rebuilding a
  posted role menu.

## Testing a module

`pnpm test` builds the workspace and runs the suite through Node's own test
runner. Tests live in a `test` directory beside the module.

Two things shape how a module should be laid out for testing. Tests import
built output, not source. And Node runs TypeScript by stripping the types out
instead of compiling, so a file under test cannot use syntax that needs real
code generation.

The practical consequence is worth following even if you never write a test:
**keep the logic worth checking in a file that does not import discord.js.**
Rule evaluation, curve arithmetic, template rendering and permission decisions
are all pure functions of their inputs, and pulling them out of the handler
makes them both testable and easier to read.

```ts
// src/levels.ts - no discord.js import
export function levelForXp(xp: number): number { ... }
```

```ts
// test/levels.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelForXp } from "../dist/levels.js";

test("is monotonic", () => {
  assert.ok(levelForXp(500) >= levelForXp(499));
});
```

Settings parsing is pure too, so a schema can be checked without a Discord
connection at all:

```ts
const result = module.settings.parse({ channel: "123456789012345678" });
if (!result.ok) console.log(result.errors);
```
