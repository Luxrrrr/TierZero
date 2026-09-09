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
| `s.boolean()` | boolean | checkbox |
| `s.duration({ max })` | milliseconds | text input accepting `30s`, `15m`, `2h`, `7d` |
| `s.channel({ types })` | snowflake | channel picker, filtered by type |
| `s.role()` | snowflake | role picker, with unassignable roles greyed out |
| `s.choice({ options })` | string | select |
| `s.emoji()` | string | text input accepting a unicode or `<:name:id>` emoji |
| `s.template({ placeholders })` | string | textarea with insertable placeholders and a character count |
| `s.array(field, { min, max })` | array | repeating rows with add and remove |
| `s.object({ ... })` | object | grouped fields |

Every builder takes `label`, `help` and `optional`. A field with a `default` is
used whenever stored settings do not carry that key, so a module can add a
setting later without a database migration.

Settings reach handlers already parsed. `ctx.settings` is typed from the schema,
so a handler never validates anything itself and never sees the raw JSON.

## Commands

Each command declares its own name, which must be unique across all modules.
The registry rejects a duplicate at startup, so two modules can never end up
fighting over one command at runtime.

Commands are registered per guild. The set is recalculated whenever a module is
toggled or an override changes, and registration is debounced so that an
operator clicking through several switches produces one API call.

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
