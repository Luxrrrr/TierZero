# Writing a module

A module is a folder under `packages/modules` that default-exports `defineModule(...)`. Its settings page shows up in the dashboard on its own.

To add one:

1. Add a project reference to the root `tsconfig.json`.
2. Add it to `dependencies` in `apps/bot/package.json`.
3. Import it in `apps/bot/src/index.ts` and pass it to `registry.register`.

Copy `packages/modules/utility` for the `package.json` and `tsconfig.json`.

```ts
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

`ctx.settings` is typed from the schema and already parsed, so handlers never validate anything.

## Settings

| Builder | Stored as | Dashboard control |
| --- | --- | --- |
| `s.string({ multiline, min, max })` | string | text input or textarea |
| `s.integer({ min, max })` | number | number input |
| `s.boolean()` | boolean | switch |
| `s.duration({ max })` | milliseconds | number input with a unit |
| `s.channel({ types })` | snowflake | channel picker, filtered by type and grouped by category |
| `s.role()` | snowflake | role picker, roles the bot can't assign greyed out |
| `s.choice({ options })` | string | select |
| `s.emoji()` | string | text input for a unicode or `<:name:id>` emoji |
| `s.template({ placeholders })` | string | textarea with insertable placeholders and a preview |
| `s.array(field, { min, max })` | array | chips, tags or removable rows, depending on the item |
| `s.object({ ... })` | object | a card at the top level, a subgroup inside one |

Every builder takes `label`, `help` and `optional`. A field with a `default` falls back to it when the stored settings lack the key, so adding a setting needs no migration.

### Extra keys

These don't change parsing. The dashboard reads them.

`essential: true` marks a setting the module can't do anything without. It's usually `optional` too, since the module has to load before anyone configures it. The dashboard shows the module as needing setup and lists the empty fields.

```ts
channel: s.channel({ types: ["text"], optional: true, essential: true, label: "Log channel" }),
```

`when: { field, equals }` makes a field apply only when a sibling has a value. Leave out `equals` to mean "any value". The dashboard greys the field out and explains why using the sibling's label, so don't repeat that in `help`. Naming a sibling that doesn't exist fails the tests.

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

`guided: true` includes a setting in the quick setup. The quick setup shows the fields tagged `guided` plus every `essential` one, through the normal form renderer. Tag only what someone has to decide before the feature works. A module that tags nothing has no quick setup. Settings it doesn't show keep their values, and a tagged field's `when` sibling is pulled in too.

```ts
modLogChannel: s.channel({ types: ["text"], optional: true, guided: true, label: "Mod log channel" }),
```

Which modules the quick setup groups, and in what order, is in `apps/web/lib/guided.ts`. It's the one place the dashboard names modules directly.

### Groups with a switch

A top-level `s.object` is drawn as a card. If its first field is a boolean named `enabled`, it becomes a switch in the card header and the rest of the group dims while it's off. Name the boolean something else to keep it in the body.

```ts
transcript: s.object(
  {
    enabled: s.boolean({ label: "Save a transcript when a ticket closes", default: true }),
    channel: s.channel({ types: ["text"], optional: true, when: { field: "enabled", equals: true } }),
  },
  { label: "Transcripts" },
),
```

### Areas

A module's settings are at `/guilds/:id/:moduleId`. Set `area` to host them inside a bigger part of the dashboard:

```ts
export default defineModule({
  id: "automod",
  category: "moderation",
  area: "moderation",
  // ...
});
```

`moderation` is the only area. Moderation and automod settings live on the Moderation Settings tab (`/guilds/:id/mod/settings` and `.../automod`), the old module pages redirect there, and the sidebar doesn't list them twice. The tab needs Manage Server, which staff roles don't include.

Link to a module's settings with `moduleHref` from `apps/web/lib/module-href.ts`. It returns the hosted address when there is one.

## Rows

A setting that's a list of objects (feeds, role menus, reward tiers) is drawn as one row per entry. `rows` adds a status line and buttons to those rows without dashboard code. The key is the list's schema path without indices.

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

`tone` is `ok`, `problem` or `idle`. An action's `input` is a normal settings object, validated by the bot like any other. `message` is shown to whoever pressed the button.

Both hooks see the settings as last saved, never a draft, so the dashboard disables the buttons while there are unsaved changes. A row arrives as a `RowRef`: its indexed path (`patchNotes.destinations[0].games[1]`), the row, and the object holding the list.

## Commands

Command names are unique across all modules, and the registry throws on a duplicate at startup. Commands are registered per server and re-synced, debounced by five seconds, when a module is toggled or an override changes.

### Right-click entries

`contextCommands` adds entries to Discord's right-click menu on members and messages. They share the name space, the Commands page and the per-server switches with slash commands, so a name has to be unique across both. Names can contain spaces and capitals. Discord allows five of each kind per server.

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

`setDefaultMemberPermissions` only controls who sees the entry. Check authorization yourself in `run`, and again on a modal submit if you open one.

## Events

All optional, and only called for servers where the module is on.

| Handler | Fires on |
| --- | --- |
| `messageCreate(message, ctx)` | a message in a server, bots excluded |
| `messageDelete(message, ctx)` | a deletion, often a partial message |
| `messageUpdate(before, after, ctx)` | an edit |
| `memberJoin(member, ctx)` | someone joins |
| `memberLeave(member, ctx)` | someone leaves or is removed |
| `memberUpdate(before, after, ctx)` | nickname, roles or timeout changed |
| `channelCreate(channel, ctx)` / `channelDelete` | a channel is created or deleted |
| `roleCreate(role, ctx)` / `roleDelete` | a role is created or deleted |
| `banAdd(ban, ctx)` / `banRemove(ban, ctx)` | a ban is placed or lifted |

Partials are on, so an object the bot never cached arrives with most fields null. Handle that. Each handler runs in its own try/catch, so a throw is logged with the module id and the other modules still get the event.

## Lifecycle

- `onEnable(ctx)` runs when the module is switched on for a server.
- `onDisable(ctx)` runs when it's switched off. Clean up what the module created.
- `onSettingsChange(ctx, previous)` runs after settings are saved. Use it for one-off work like rebuilding a posted role menu.

## Buttons and modals

Custom ids are namespaced to the module. Build them with `customId`:

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

The router splits the id and hands the interaction to the module that owns it, so two modules can each have a `confirm` button.

## Deferred work

Use `ctx.tasks` for anything that has to happen later, not a timer:

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

Tasks are database rows, so they survive a restart. `cancel` matches on a subset of the payload.

## Testing

`pnpm test` builds the workspace and runs Node's built-in test runner. Tests go in a `test` folder next to the module and import the built output.

Node strips types without compiling, so a file under test can't use syntax that needs real compilation. Keep logic you want tested in a file that doesn't import discord.js.

```ts
// src/levels.ts, no discord.js import
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

A schema can be checked without Discord:

```ts
const result = module.settings.parse({ channel: "123456789012345678" });
if (!result.ok) console.log(result.errors);
```
