# Writing a module

A module is a folder under `packages/modules` that default-exports a call to `defineModule`. Its settings page shows up in the dashboard by itself, so you don't write one.

To wire a new module in:

1. Add a project reference in the root `tsconfig.json` so `tsc -b` builds it.
2. Add it to `dependencies` in `apps/bot/package.json`.
3. Import it in `apps/bot/src/index.ts` and pass it to `registry.register`.

Copy `packages/modules/utility` for the `package.json` and `tsconfig.json`. It's small on purpose and exists to be the example.

## A module

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

## Settings

Each builder in `s` gives you a validator and the metadata the dashboard needs to draw a control. One form renderer handles any schema, which is why modules don't ship UI.

| Builder | Stored as | Dashboard control |
| --- | --- | --- |
| `s.string({ multiline, min, max })` | string | text input or textarea |
| `s.integer({ min, max })` | number | number input |
| `s.boolean()` | boolean | switch |
| `s.duration({ max })` | milliseconds | number input with a unit |
| `s.channel({ types })` | snowflake | channel picker, filtered by type and grouped by category |
| `s.role()` | snowflake | role picker, with roles the bot can't assign greyed out |
| `s.choice({ options })` | string | select |
| `s.emoji()` | string | text input that takes a unicode or `<:name:id>` emoji |
| `s.template({ placeholders })` | string | textarea with insertable placeholders and a preview |
| `s.array(field, { min, max })` | array | chips, tags or removable rows, depending on the item |
| `s.object({ ... })` | object | a card at the top level, a subgroup below that |

Every builder takes `label`, `help` and `optional`. A field with a `default` uses it whenever the stored settings don't have that key, so you can add a setting without a migration.

Handlers get settings already parsed. `ctx.settings` is typed from the schema, and a handler never validates anything or sees raw JSON.

### Metadata the dashboard reads

Three more keys don't affect parsing.

**`essential: true`** marks a setting the module can't do anything without. It's nearly always `optional` as well, because the module has to load before anyone can configure it. The dashboard shows the module as needing setup and lists the empty fields.

```ts
channel: s.channel({
  types: ["text"],
  optional: true,
  essential: true,
  label: "Log channel",
}),
```

**`when: { field, equals }`** names a sibling in the same object and means "only applies when that one says so". Leave out `equals` and it applies whenever the sibling has any value. The dashboard disables the field while the condition isn't met and explains why, using the sibling's label, so don't repeat that in `help`. A sibling that doesn't exist fails the test suite.

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

**`guided: true`** marks a setting the quick setup asks about. The quick setup draws a reduced copy of your schema, with the fields tagged `guided` plus every `essential` one, through the same renderer as the full page. Tag the few things someone has to decide before the feature is useful and leave the rest. A module that tags nothing gets no quick setup, which is fine if its settings are all repeating rows.

```ts
modLogChannel: s.channel({
  types: ["text"],
  optional: true,
  guided: true,
  label: "Mod log channel",
}),
```

The quick setup sends the module's whole settings object back, so settings it doesn't show keep their values. A tagged field whose `when` names a sibling pulls that sibling in too, so you never see a control greyed out with the switch that enables it left on the full page.

Which modules the quick setup walks, and in what order, is set in `apps/web/lib/guided.ts`. It's the only place the dashboard names modules directly. A module that isn't installed is dropped from a bundle.

### Groups that switch off

A top-level `s.object` becomes its own card. If its first field is a boolean named `enabled`, the dashboard moves it into the card header as a switch and dims the rest of the group while it's off. Nothing enforces the name. Call the boolean something else if you want it to stay in the body.

```ts
transcript: s.object(
  {
    enabled: s.boolean({ label: "Save a transcript when a ticket closes", default: true }),
    channel: s.channel({ types: ["text"], optional: true, when: { field: "enabled", equals: true } }),
  },
  { label: "Transcripts" },
),
```

### Hosting settings in an area

Each module's settings page is at `/guilds/:id/:moduleId`. A module that belongs to a bigger part of the dashboard can say so with `area`:

```ts
export default defineModule({
  id: "automod",
  category: "moderation",
  area: "moderation",
  // ...
});
```

`moderation` is the only area. The form is still drawn from the schema and saves the same way. Only where it sits changes. Moderation and automod live under the Moderation tabs, at `/guilds/:id/mod/settings` and `/guilds/:id/mod/settings/automod`, and the old module pages redirect there. They aren't listed again in the sidebar. They still need Manage Server, which a staff role doesn't grant, so the Settings tab only shows for server managers.

Link to a module's settings with `moduleHref` from `apps/web/lib/module-href.ts`, which returns the hosted address when there is one. Don't build `/guilds/${id}/${module.id}` by hand.

## Rows: status and actions

A setting that's a list of objects (feeds, role menus, reward tiers) is drawn as one row per entry. You can attach a status line and buttons to those rows without any dashboard code, with `rows`, keyed by the list's schema path without indices.

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

`tone` is `ok`, `problem` or `idle`, and `text` is what the row shows. An action's `input` is a normal settings object, so the dashboard asks for it with the usual controls and the bot validates it the same way. Whatever `run` returns as `message` is shown to the person who pressed the button, so say what happened.

Both hooks work on the settings as last saved, not on a draft. That's why the dashboard disables the buttons while there are unsaved changes. A row arrives as a `RowRef`: its indexed path (`patchNotes.destinations[0].games[1]`), the row itself, and the object that holds the list. That lets a game be read in the context of the channel it sits under.

## Commands

Each command has a name, which has to be unique across every module. The registry rejects a duplicate at startup.

Commands are registered per server. The set is recalculated when a module is toggled or an override changes, and registration is debounced so clicking through several switches makes one API call.

### Right-click entries

`contextCommands` adds entries to Discord's right-click menu on members and messages. They share the command namespace, the Commands page and the per-server switches with slash commands, so a name must be unique across both. Discord allows spaces and capitals in these names, and at most five of each kind per server.

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

`setDefaultMemberPermissions` only controls who sees the entry. It isn't an authorization check, so `run` has to do its own. If it needs input, open a modal and check again on submit.

## Events

Handlers are optional and only run for servers where the module is switched on.

| Handler | Fires on |
| --- | --- |
| `messageCreate(message, ctx)` | a message in a server, bots excluded |
| `messageDelete(message, ctx)` | a deletion, often with a partial message |
| `messageUpdate(before, after, ctx)` | an edit |
| `memberJoin(member, ctx)` | someone joins |
| `memberLeave(member, ctx)` | someone leaves or is removed |
| `memberUpdate(before, after, ctx)` | nickname, roles or timeout changed |
| `channelCreate(channel, ctx)` / `channelDelete` | a channel is created or deleted |
| `roleCreate(role, ctx)` / `roleDelete` | a role is created or deleted |
| `banAdd(ban, ctx)` / `banRemove(ban, ctx)` | a ban is placed or lifted |

Partials are on, so anything about an object the bot never cached arrives with most fields null. Handle that or your log fills with `undefined`.

Each handler runs in its own try/catch. If your module throws, it's logged with the module id and the others still get the event.

## Lifecycle hooks

- `onEnable(ctx)` runs when someone switches the module on for a server.
- `onDisable(ctx)` runs when they switch it off. Remove whatever the module created, because it might be switched on again later.
- `onSettingsChange(ctx, previous)` runs after settings are saved. Use it for work that should happen once and not on every command, such as rebuilding a posted role menu.

## Buttons and modals

Components are addressed by a custom id, which is namespaced to the module:

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

The router splits the id, finds the module that owns it and passes the interaction on, so two modules can both have a `confirm` button without clashing. Always build ids with `customId`.

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

Tasks are database rows, so a restart between scheduling and running loses nothing. `cancel` matches on a subset of the payload, so reversing something by hand can drop its pending task without knowing what else was stored with it.

## Testing

`pnpm test` builds the workspace and runs the tests with Node's built-in runner. Put them in a `test` folder next to the module. They import the built output, not the source.

Node runs TypeScript by stripping types, so a file under test can't use syntax that needs real compilation. Keep logic you want tested in a file that doesn't import discord.js. Rule checks, curve math, template rendering and permission decisions are all plain functions, and pulling them out of the handler makes them testable and easier to read.

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

Settings parsing is pure too, so you can check a schema without a Discord connection:

```ts
const result = module.settings.parse({ channel: "123456789012345678" });
if (!result.ok) console.log(result.errors);
```
