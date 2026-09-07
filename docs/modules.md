# Writing a module

A module is a directory under `packages/modules` that default-exports a call to
`defineModule`. Registering it in `apps/bot/src/index.ts` is the only wiring
step; its settings page appears in the dashboard on its own.

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
| `s.array(field, { min, max })` | array | repeating rows with add and remove |
| `s.object({ ... })` | object | grouped fields |

Every builder takes `label`, `help` and `optional`. A field with a `default` is
filled in when it is absent from stored settings, which is what allows a module
to add a setting without a database migration.

Settings reach handlers already parsed. `ctx.settings` is typed from the schema,
so a handler never validates anything itself and never sees the raw JSON.

## Commands

Each command declares its own name, which must be unique across all modules.
The registry rejects a duplicate at startup rather than letting two modules
fight over one command at runtime.

Commands are registered per guild. The set is recalculated whenever a module is
toggled or an override changes, and registration is debounced so that an
operator clicking through several switches produces one API call.

## Lifecycle

All three hooks are optional.

- `onEnable(ctx)` runs when an operator switches the module on for a server.
- `onDisable(ctx)` runs when they switch it off. Remove anything the module
  created; the module may be enabled again later.
- `onSettingsChange(ctx, previous)` runs after settings are saved. Use it for
  work that has to happen once rather than on every command, such as rebuilding
  a posted role menu.

## Testing a module

Settings parsing is pure, so schema tests need no Discord connection:

```ts
const result = module.settings.parse({ channel: "123456789012345678" });
if (!result.ok) console.log(result.errors);
```
