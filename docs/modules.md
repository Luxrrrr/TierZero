# Writing a module

New modules go in `packages/modules/<id>`. Copy `utility` for the `package.json` and `tsconfig.json`, then:

1. Add a project reference to the root `tsconfig.json`.
2. Add it to `dependencies` in `apps/bot/package.json`.
3. Import it in `apps/bot/src/index.ts` and pass it to `registry.register`.

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

The settings page is generated from `settings`, and `ctx.settings` is typed from it and already parsed.

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
| `s.message({ starting, variables, delivery })` | message body | a preview and an Edit message button that opens the message editor |
| `s.array(field, { min, max, unique, default })` | array | chips, tags or removable rows, depending on the item. A list of choices with `unique: true` is a multi-select |
| `s.object({ ... })` | object | a card at the top level, a subgroup inside one |

Every builder takes `label`, `help` and `optional`. A field with a `default` falls back to it when the stored settings lack the key, so adding a setting needs no migration.

### Extra keys

These don't change parsing. The dashboard reads them.

`essential: true` marks a setting the module can't do anything without. It's usually `optional` too, since the module has to load before anyone configures it. The dashboard shows the module as needing setup and lists the empty fields.

```ts
channel: s.channel({ types: ["text"], optional: true, essential: true, label: "Log channel" }),
```

`when: { field, equals }` makes a field apply only when a sibling has a value. Leave out `equals` to mean "any value". Use `includes` instead when the sibling is a list: `when: { field: "actions", includes: "timeout" }` applies while that list contains the value. The dashboard greys the field out and explains why using the sibling's label, so don't repeat that in `help`. Naming a sibling that doesn't exist fails the tests.

```ts
actions: s.array(
  s.choice({
    options: [
      { value: "delete", label: "Delete", description: "Removes the message.", recommended: true },
      { value: "timeout", label: "Time out", description: "Mutes them for the timeout length." },
    ],
  }),
  { label: "What to do when it trips", min: 1, unique: true, default: ["delete"] },
),
timeoutDuration: s.duration({
  label: "Timeout length",
  default: "10m",
  when: { field: "actions", includes: "timeout" },
}),
```

The `actions` field above is a multi-select. Each choice option may carry a `description`, shown under its label, and `recommended: true`, which only marks it as the suggested pick; the `default` is what is actually selected. `unique: true` makes the list refuse the same value twice, and `default` on an array is what an absent list becomes (without it, an empty list).

A multi-select with four options or fewer is drawn as a row of toggle chips, with the description of the focused or hovered chip, or else of everything selected, on one line underneath. A longer list is drawn as one tall row per option, with each description beside its label. Set `layout: "rows"` or `layout: "chips"` on the array to override the choice, for example to keep the rows for options whose descriptions need a full sentence.

`collapsible: true` on a top-level `s.object` draws it as a section that is closed until opened, for a page of many similar groups. `summary` on the same object lists the keys of its own fields to show on the closed header, in order: a list of choices reads as its labels, a duration as a short length ("10 min"), a switch as its label while it is on. A field whose `when` isn't met is left out, so a timeout length only shows while a timeout is picked. A group opens by itself when it holds a validation error or the page is opened at `#<group key>`. The quick setup always draws a collapsible group open.

```ts
invites: s.object(
  { enabled: s.boolean({ default: false }), actions: s.array(/* ... */), timeoutDuration: s.duration(/* ... */) },
  { label: "Invite links", collapsible: true, summary: ["actions", "timeoutDuration"] },
),
```

`guided: true` includes a setting in the quick setup. The quick setup shows the fields tagged `guided` plus every `essential` one, through the normal form renderer. Tag only what someone has to decide before the feature works. A module that tags nothing has no quick setup. Settings it doesn't show keep their values, and a tagged field's `when` sibling is pulled in too.

```ts
modLogChannel: s.channel({ types: ["text"], optional: true, guided: true, label: "Mod log channel" }),
```

Which modules the quick setup groups, and in what order, is in `apps/web/lib/guided.ts`. It's the one place the dashboard names modules directly.

### Messages the owner can edit

Use `s.message` for anything the module sends, in place of `s.template`. The owner edits it with the same builder as the Messages page: text, embeds, buttons, menus, reactions and variables.

```ts
import { plainReply, s } from "@tier0/core";

const LEVEL_UP = plainReply("{user} reached level {level}!");

message: s.message({
  label: "Level-up message",
  starting: LEVEL_UP,
  variables: [
    { name: "user", description: "The member who levelled up, as a mention", sample: "@Ada" },
    { name: "level", description: "The level they reached", sample: "5" },
  ],
}),
```

`starting` is what the feature sends today. It is also the default, so the editor opens on the real wording and "Go back to the default" has something to return to. `variables` are the module's own placeholders, each with a sample for the preview. The ones every message has (`{server}`, `{members}`, `{channel}`, `{channel.name}`, `{date}`, `{time}`, `{now}`, `{sender}`, `{bot}`, `{server.icon}`) are always offered as well.

| Option | Default | Effect |
| --- | --- | --- |
| `delivery` | `"channel"` | `"dm"` hides reactions and the role, channel, user and mentionable menus, which Discord does not fill in outside a server. Buttons and text menus stay and work. A direct message also mentions nobody. |
| `components` | `true` | `false` hides buttons and menus entirely. |
| `note` | none | A caveat shown beside the preview, for a setting that covers more than one situation. |
| `compact` | `false` | `true` draws the setting as one row: the label, a one-line summary of the text, and the Edit message button, with no preview. Consecutive compact messages form one divided list. Use it for a group of minor messages, and leave the message a page is about with its preview. |

The parsed value is a `MessageBody`. A value stored while the setting was still an `s.template` string is accepted and read as a message that is only that text, so changing a setting from `s.template` to `s.message` loses nothing. Anything that is missing or blank falls back to `starting`, and a message that fails Discord's limits is a validation error like any other.

Send it with `ctx.send`, which takes a channel, a user or a member:

```ts
await ctx.send(channel, ctx.settings.announce.message, { user: `<@${member.id}>`, level }, { fallback: LEVEL_UP });
```

`ctx.send` fills the shared variables, then the values you pass (which win on a clash), checks the message again because variables can lengthen it, sends it, and afterwards stores what its buttons do and adds its reactions. A button in a direct message is stored against the server the module runs for, so pressing it acts on that server; with no server known, only link buttons are sent. It resolves to the sent message, or to null if nothing was sent. It never throws: a closed DM or a missing permission is logged and the feature carries on. If the message no longer fits once filled in, `fallback` is sent instead, so a feature doesn't go silent over an owner's edit. Pass `sender` in the options to set `{sender}`, which is the bot's name otherwise. When the module owns a button or menu of its own, such as one answered by its `components` handler, set `components: false` on the field and pass the row you built as `rows`, which is placed under the message's own. `files` attaches files. `mentions: { users, roles }` lists the ids the post may ping and nothing else; pass it when the text includes anything a member wrote, and empty lists for a post that pings no one. Without it a channel post may ping any user or role it mentions.

`ctx.dashboardUrl()` resolves the address the dashboard is opened at, with no trailing slash, or an empty string when it isn't known. It is the moderation module's **Dashboard address** setting if set, else the address the instance owner last opened the dashboard at, read from the database and cached for 30 seconds. Build links from it with `dashboardLinks(base, guildId, userId, caseNumber)` from `@tier0/core`, which gives `caseUrl` and `memberUrl`, both empty when there is no address. A link button whose address comes out empty or isn't an http(s) address is dropped when the message is filled in, so a post that has no address simply has no button. `viewCaseButton()` is the default one. A link button's address may contain a variable, as in `{caseUrl}`, and the editor accepts that while it is being typed. An `s.string({ origin: true })` setting is stored as an origin: a pasted path or trailing slash is dropped and anything that isn't an http(s) address is refused.

Two companions cover the other places a message goes. `ctx.edit(message, body, values, { fallback, rows })` rewrites a message the module posted earlier, for a post that is refreshed in place, and resolves to null if it could not. `ctx.reply(interaction, body, values, { fallback, ephemeral })` answers a button, modal or command with the owner's message. It is ephemeral unless you pass `ephemeral: false`, edits the reply if the interaction was deferred, and drops buttons other than links, since nothing is stored to answer them. It resolves to false when nothing could be sent.

A line that should only exist some of the time, such as an expiry on an action that may not expire, is an embed field whose value is a variable. When the variable fills to nothing the field is left out, instead of the whole message failing Discord's check for an empty field. For text in a sentence, give the variable its own punctuation and leading space, empty when there is nothing to say, so the template stays a plain fill-in.

When you turn two settings into one message, say a title and a body, write an `upgrade` on the `s.object` that holds them. Settings are validated on read and unknown keys are dropped, so without it the owner's old wording would quietly go back to the default. It receives the stored object and returns the one to validate, runs on every read, and must leave an already-current value alone:

```ts
s.object({ message: s.message({ /* ... */ }) }, { upgrade: (stored) => /* old title and body become message */ stored });
```

Keep the upgrade in a file that doesn't import discord.js so its tests are plain input and output. The implementation is `apps/bot/src/runtime/send-message.ts`, where `renderMessage` is the pure half if you need the payload without sending.

### Every visible text is a setting

Anything a member, a moderator or a server owner can read because of your module is a setting with the current wording as its default. Nothing the bot says should need a code change to reword. Two kinds, kept apart:

- **Messages**: anything sent to a channel, a direct message or an interaction, including an ephemeral refusal or error. Use `s.message` with the variables the text needs (`{role}`, `{limit}`) and a `help` that says when it fires. Put them in one `collapsible` group with `compact: true` on each, called "Replies and errors", with sub-groups by feature if there are many. Send through `ctx.send`, `ctx.reply` or `ctx.edit`, passing the default as `fallback`.
- **Short strings Discord limits**: modal titles and labels (45), placeholders (100), button labels (80), select options (100), channel names, topics, webhook names (80) and audit-log reasons (512). Use `s.string` or `s.template` with `max` set to Discord's limit and the placeholders declared, in a separate collapsible group called "Labels and text". Sanitise a channel name after its variables are filled in.

Shared code that can refuse something (a hierarchy check, a policy function) returns a stable code and the values, not a sentence. The place that replies looks the sentence up in the module's settings. Refusals shown in the dashboard to moderators, rather than in Discord, keep the dashboard's wording. Command names, descriptions and option descriptions are registered with Discord at sync time under fixed limits, so they are not settings.

The dashboard's Bot messages page finds every `s.message` field by walking the schema, at any depth and inside lists, so a message that follows this needs no dashboard code to appear there.

### Built-in modules

A module with `alwaysOn: true` is part of the bot, not a feature an owner picks. It has no switch, counts as enabled in every server without a `GuildModule` row, is left out of the sidebar's feature list and the overview, and cannot be disabled through the control API (the `PATCH` is refused with a 400). Its settings are stored per server like any other module's and a server that never saved them runs on the defaults. The registry's `describe()` reports it as `alwaysOn`.

The only one is `system` (`packages/modules/system`), which holds the text the command router and the button handlers send on their own: refusals, the failure notice, the role button replies and a few labels. It has no commands or events. Code outside a module reads it through `GuildState.systemSettings(guildId)` and sends with `replySystem` in `apps/bot/src/runtime/system-messages.ts`, which falls back to the default wording when the settings can't be read. A handler that throws gets the same failure reply (the `componentFailed` message), so a member never sees Discord's own "This interaction failed".

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

Command names are unique across all modules, and the registry throws on a duplicate at startup. A command whose reply an owner may rewrite declares `response: { starting, placeholders }`. `starting` is the message the editor opens with, written to match what the command says now, and each placeholder has a name, a description and a sample for the preview. In the handler, call `ctx.customReply?.({ ...values })` and send that when it isn't null; otherwise reply the way the command always has.

Commands are registered per server and re-synced, debounced by five seconds, when a module is toggled or an override changes.

### Right-click entries

`contextCommands` adds entries to Discord's right-click menu on members and messages. They share the name space, the Commands page and the per-server switches with slash commands, so a name has to be unique across both. Names can contain spaces and capitals. Discord allows five of each kind per server. An entry can declare `response` like a slash command, and its handler asks `ctx.customReply` the same way.

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
