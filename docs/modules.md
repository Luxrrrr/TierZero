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
| `s.duration({ min, max })` | milliseconds | number input with a unit |
| `s.channel({ types })` | snowflake | channel picker, filtered by type and grouped by category |
| `s.role({ assigns })` | snowflake | role picker. Every role can be picked unless `assigns: true`, which greys out roles above the bot's own |
| `s.choice({ options })` | string | select |
| `s.emoji()` | string | picker of the server's own emoji and a set of standard ones, or a pasted one |
| `s.template({ placeholders, samples })` | string | textarea with insertable placeholders and a preview |
| `s.message({ starting, variables, delivery })` | message body | a preview and an Edit message button that opens the message editor |
| `s.array(field, { min, max, unique, default, item })` | array | chips, tags or rows, depending on the item. A list of choices with `unique: true` is a multi-select |
| `s.object({ ... })` | object | a card at the top level, a subgroup inside one |

Every builder takes `label`, `help` and `optional`. A field with a `default` falls back to it when the stored settings lack the key, so adding a setting needs no migration.

`s.duration` takes `min` and `max` written like `"1m"` and `"28d"`. Written input outside them is refused ("must be at least 1 minute"). A number, which is the stored form, is pulled inside them instead, because every read of saved settings goes through the same parse and a refusal there leaves the module unconfigured. Adding a `min` to an existing setting therefore raises a lower stored value to the `min` on the next read. Without `min`, zero is allowed.

`s.emoji` accepts one emoji as people see it (joined emoji and flags included) or Discord's `<:name:id>`. The dashboard turns a typed `:name:` into the server's emoji of that name, which it gets from `GET /guilds/:id/emojis` on the control API (`{ id, name, animated, url }[]`). Without that route the picker offers the standard set only.

`s.template` takes `samples`, the values its preview shows for each placeholder, as in `samples: { position: "1", xp: "1,250" }`. Common names (`user`, `username`, `level`, `memberCount`) have stand-ins already, and `{server}` shows the real server's name. `preview: "channel"` previews the text as the channel name Discord would make of it (`# ticket-fragmuffin`) instead of as a message.

`s.string({ url: true })` holds a whole http(s) address, such as a feed's, and refuses anything else. The dashboard gives it a whole row. Like every validator it also runs on read, so adding it to a setting that may already hold a bad address needs an `upgrade` that clears or fixes those values, or the module stops loading its settings.

### Extra keys

These don't change parsing. The dashboard reads them.

`essential: true` marks a setting the module can't do anything without. It's usually `optional` too, since the module has to load before anyone configures it. While the module is on and the field is empty, the module's header, the sidebar and the overview say **Needs setup** instead of **On**, and the page lists the empty fields.

```ts
channel: s.channel({ types: ["text"], optional: true, essential: true, label: "Log channel" }),
```

`essential: "<set>"` is for a module that needs one of several settings rather than one in particular. Give every member of the set the same name, anywhere in the schema (nested groups included, list rows not). The module needs setup while none of them is filled in; a switch counts as filled while it is on, a list once it has a row. The page then asks for "one of" the members by label, and the quick setup asks about all of them.

```ts
// Welcome does something once it greets, says goodbye or sends a DM.
join: s.object({
  channel: s.channel({ optional: true, essential: "target", label: "Channel to greet in" }),
  roles: s.array(s.role({ assigns: true }), { essential: "target", label: "Roles to give on join" }),
  sendDm: s.boolean({ default: false, essential: "target", label: "Send the new member a direct message" }),
}),
leave: s.object({
  channel: s.channel({ optional: true, essential: "target", label: "Channel to post departures in" }),
  sendDm: s.boolean({ default: false, essential: "target", label: "Send a departing member a direct message" }),
}),
// Role menus: one set of one, so an empty list reads as Needs setup.
menus: s.array(menuField, { essential: true, label: "Role menus" }),
// Feeds: either kind of source.
news: s.object({ feeds: s.array(feed, { essential: "source", label: "News feeds" }) }),
patchNotes: s.object({ destinations: s.array(destination, { essential: "source", label: "Steam games" }) }),
```

A list with `essential: true` works the same way as a channel: an empty list is missing. Label every essential field, since the label is what the owner reads. A group's `enabled` switch in a set is named by the group's label, so automod can tag each rule's switch `essential: "rules"` and read "Needs setup" while every rule is off, listing the rules by name.

`assigns: true` on a role field means the bot gives that role to members (a join role, a role menu option, a level reward, a mute role). Only there does the picker grey out roles above the bot's own and say why. Leave it off for a role the bot only checks or mentions (exemptions, who may run a command, ticket handlers, pings), so staff roles above the bot can still be picked. On a list of roles, put it on the item: `s.array(s.role({ assigns: true }))`.

`item: "<noun>"` on an `s.array` of objects names one row for the Add button, singular and lower case: `item: "game"` reads "Add game" rather than a guess made from the label.

`when: { field, equals }` makes a field apply only when a sibling has a value. Leave out `equals` to mean "any value". Use `includes` instead when the sibling is a list: `when: { field: "actions", includes: "timeout" }` applies while that list contains the value. The dashboard greys the field out and explains why using the sibling's label, so don't repeat that in `help`. Add `hide: true` to leave it out instead of greying it out (see Controls and conditions). Naming a sibling that doesn't exist fails the tests.

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

`section: "<name>"` on a top-level setting puts it in a named part of the settings page, for a module with enough settings to split it. Settings sharing a value are drawn together, in schema order, with a list of the parts beside the form; top-level settings that name no section go in a last part. `#section-<name>` in the address opens a part. Only top-level settings may carry it.

`layout` on a top-level `s.object` changes how the group is drawn, for a group too long to read as a stack of fields. `layout: "messages"` draws every message in it, at any depth, as one list: a row per message with its label, its `help` as the line saying when it is sent, a line of what it says now, a Default or Customised tag, and Edit and Reset buttons, with a search box and a Customised only filter above. `layout: "fields"` draws its settings as labelled inputs in two columns, each with a Reset link once it differs from its default. Either way the group declares its headings in `topics`, in the order they are drawn, and each setting names its heading with `topic: "<id>"`. A `topic` on a nested group applies to everything in it that names no other. A heading with `within: "<id>"` is drawn inside that heading, closed until opened, which suits a run of refusals few owners need. A nested group in a `fields` list whose label matches its heading is drawn as that heading's own fields, and any other keeps a small title of its own. Settings that name no heading go under a last one named after the group, and a heading with nothing under it is left out.

```ts
messages: s.object(
  {
    claimed: s.message({ label: "Claimed", help: "Posted in the ticket when a handler claims it.", topic: "open", audience: "public", starting: CLAIMED }),
    refusals: s.object({ notStaff: replyField("notStaff") }, { topic: "notAllowed" }),
  },
  {
    label: "What the bot says",
    layout: "messages",
    topics: [
      { id: "open", label: "While a ticket is open" },
      { id: "wrong", label: "When something goes wrong" },
      { id: "notAllowed", label: "Not allowed", within: "wrong" },
    ],
  },
),
```

A message in another group may also name a heading of a messages list, and is then listed there as well as in its own place. Both show the same setting. A message inside a list row can't, since each row has its own wording. The Bot messages page files a feature's messages under these headings too. The schema check fails a `topic` no list declares, a heading nested more than once, a `layout` below the top level, anything but messages in a messages list and a message in a fields list. Changing a group's layout or moving settings between headings doesn't change what is stored, so it needs no `upgrade`.

`s.string({ generated: true })` is a stable id for a row in a list, which other records point at. The dashboard draws nothing for it, leaves it out of row summaries, and fills it with eight random hex characters when a row is added (the shape `generatedId()` from `@tier0/core` makes, for code outside the browser), so renaming or reordering rows doesn't break those links. It must match `GENERATED_ID` (up to 32 letters, digits, `-` and `_`) and may be missing, so old rows parse; fill those in from an `upgrade`. Only list rows may carry one.

`guided: true` includes a setting in the quick setup. The quick setup shows the fields tagged `guided` plus every `essential` one (every member of an essential set too), through the normal form renderer, and saving a step turns that feature on. A `collapsible` group it shows open still carries its `summary` line, so a switched-on rule says what it does. Tag only what someone has to decide before the feature works. A module that tags nothing has no quick setup. Settings it doesn't show keep their values, and a tagged field's `when` sibling is pulled in too.

```ts
modLogChannel: s.channel({ types: ["text"], optional: true, guided: true, label: "Mod log channel" }),
```

Which modules the quick setup groups, and in what order, is in `apps/web/lib/guided.ts`. It's the one place the dashboard names modules directly.

### Rows with a lot in them

A list of rows that is more than a few settings each reads badly as a stack of accordions. Three opt-in pieces of metadata change how one is drawn. All of them are dashboard-only, none changes what is stored, and a list that uses none is drawn as before. `formLayoutProblems` in the schema check fails a reference that names nothing.

**`steps`** on the `s.object` that is a row declares numbered parts, each with a title and a line saying what it is for. A setting names its part with `step`; one that names none goes in the first. A part holding a single setting lets the title stand in for that setting's label and help. A row with steps also gets a quieter set of controls: the header offers Edit or Collapse, Duplicate and Remove move into a menu behind three dots (Remove asks first), and the open row ends in Collapse instead of Done. A page can draw a status in the header and a block at the foot of such a row, keyed by the list's path (`rowSlots` on `ModulePage`), without the form knowing what the rows are.

```ts
export const panelField = s.object(
  {
    name: s.string({ label: "Name", step: "where" }),
    channel: s.channel({ label: "Channel", step: "where" }),
    message: s.message({ label: "Panel message", step: "see", /* ... */ }),
    types: s.array(typeField, { label: "Ticket types", step: "types", /* ... */ }),
  },
  {
    steps: [
      { id: "where", title: "Where it goes", help: "Pick the channel." },
      { id: "see", title: "What members see" },
      { id: "types", title: "Ticket types", help: "One for each kind of ticket." },
    ],
  },
);
```

**`layout: "sheet"`** on an `s.array` of objects draws each row as a card, and Edit opens the row in a sheet from the right instead of unfolding it. `card` says what the card shows, as paths from the row: `emoji` (an emoji setting), `swatch` (a choice whose options carry a `swatch` colour, drawn as a dot), `chips` (a list of roles) and `facts` (settings read out as short phrases: a choice as its label, a list of rows as a count, using the list's `item` for the noun). The card's name is the first filled text setting. Reordering works from the card; Add and Remove (with a confirm) and Duplicate are the sheet's and the list's. The sheet is a dialog: Escape and the scrim close it, Tab stays inside it, focus returns to the card's Edit button, and on a phone it is the whole screen. It edits the same draft as the page, so closing it keeps every change and the page's Save applies them. A row with a refused setting opens the sheet by itself, on the tab that holds it.

Inside a sheet row, `section` names a tab, on any setting at any depth, and a group's `section` is the default for what is inside it. Tabs are listed in order of first appearance, labelled from the id (`"people"` reads People), and a setting naming none is drawn in the first. A group whose settings are spread over several tabs is drawn in each with only the settings that belong there, headed by its entry in `tabLabels` for that tab (falling back to its own label), which lets one stored group serve two tabs without changing its shape.

```ts
opening: s.object(
  {
    mode: s.choice({ /* ... */ section: "basics" }),
    ping: s.choice({ /* ... */ section: "people" }),
  },
  { label: "Where tickets open", tabLabels: { basics: "Where tickets open", people: "Who is told" } },
),
```

`nudge: "<short note>"` on a setting asks for nothing, but while it is empty the row's card shows the note in amber and its tab carries a marker. An `essential: true` setting that is empty does the same ("No category yet") while its `when` is met. A refused setting marks its tab in red. `nudge` never refuses a save and leaves the module's status alone, unlike `essential`.

**`formPreview: { kind: "modal", title, label, placeholder, style, required }`** on a list of rows that are the questions of a form adds a Preview button under the list that draws the form as Discord shows it. `title` is a text setting beside the list; the rest are paths in each row.

### Controls and conditions

`control: "segmented"` on an `s.choice` draws two to four options as a row of toggle buttons, with the chosen option's `description` underneath, instead of a drop-down. `control: "swatches"` draws them as colour dots with their names and needs a `swatch` (a CSS colour) on every option.

`when: { field, equals, hide: true }` leaves the setting out of the form while the condition is not met, instead of drawing it greyed out with a sentence about why. Use it where the greyed control would only be a puzzle, such as a menu's placeholder while buttons are picked; the value stays stored. Without `hide` the field is greyed out as before.

An `attach` of `kind: "list"` draws an add button in the message preview unless it says `add: false`, which is for a list that is edited, with its own add button, on the same screen.

### Messages the owner can edit

Use `s.message` for anything the module sends, in place of `s.template`. The owner edits it with the same builder as the Message creator: text, embeds, buttons, menus, reactions and variables.

```ts
import { embedReply, s } from "@tier0/core";

const LEVEL_UP = embedReply("You reached level {level}.", "info", { ping: "{user}" });

message: s.message({
  label: "Level-up message",
  starting: LEVEL_UP,
  variables: [
    { name: "user", description: "The member who levelled up, as a mention", sample: "@Ada" },
    { name: "level", description: "The level they reached", sample: "5" },
  ],
}),
```

Write defaults with `embedReply(text, kind, { ping?, title? })`, which gives a coloured embed. `kind` is `"error"`, `"success"`, `"warning"` or `"info"`, and the colours live in `REPLY_COLOR` so every module matches. Put a mention that has to notify someone in `ping`, which is sent as text above the embed, since a mention inside an embed does not ping. `plainReply` stays for compatibility with text stored before the editor existed; new defaults should not use it.

`starting` is what the feature sends today. It is also the default, so the editor opens on the real wording and "Go back to the default" has something to return to. `variables` are the module's own placeholders, each with a sample for the preview. The ones every message has (`{server}`, `{members}`, `{channel}`, `{channel.name}`, `{date}`, `{time}`, `{now}`, `{sender}`, `{bot}`, `{server.icon}`) are always offered as well.

| Option | Default | Effect |
| --- | --- | --- |
| `delivery` | `"channel"` | `"dm"` hides reactions and the role, channel, user and mentionable menus, which Discord does not fill in outside a server. Buttons and text menus stay and work. A direct message also mentions nobody. |
| `components` | `true` | `false` hides buttons and menus entirely. |
| `note` | none | A caveat shown beside the preview, for a setting that covers more than one situation. |
| `compact` | `false` | `true` draws the setting as one row: the label, a one-line summary of the text, and the Edit message button, with no preview. Consecutive compact messages form one divided list. Use it for a group of minor messages, and leave the message a page is about with its preview. |
| `audience` | none | Who sees it, shown beside the message in a messages list: `"public"` for everyone in the channel, `"private"` for the person it answers, `"dm"` for a direct message. |
| `attach` | none | The buttons or menu the feature adds under the message itself, drawn under the preview and editable there. `{ kind: "list", list, label, ... }` makes one button per row of a sibling list, or one menu when `mode` says so. `{ kind: "buttons", buttons }` is a fixed set whose text and colour live in other settings. Paths starting with `/` are read from the top of the module's settings, and the schema check fails one that names no setting. |

The parsed value is a `MessageBody`. A value stored while the setting was still an `s.template` string is accepted and read as a message that is only that text, so changing a setting from `s.template` to `s.message` loses nothing. Anything that is missing or blank falls back to `starting`, and a message that fails Discord's limits is a validation error like any other.

Send it with `ctx.send`, which takes a channel, a user or a member:

```ts
await ctx.send(channel, ctx.settings.announce.message, { user: `<@${member.id}>`, level }, { fallback: LEVEL_UP });
```

`ctx.send` fills the shared variables, then the values you pass (which win on a clash), checks the message again because variables can lengthen it, sends it, and afterwards stores what its buttons do and adds its reactions. A button in a direct message is stored against the server the module runs for, so pressing it acts on that server; with no server known, only link buttons are sent. It resolves to the sent message, or to null if nothing was sent. A channel post with embeds that Discord refuses for missing permissions is retried once as plain text, written out by `flattenEmbeds`, and logged. It never throws: a closed DM or a missing permission is logged and the feature carries on. If the message no longer fits once filled in, `fallback` is sent instead, so a feature doesn't go silent over an owner's edit. Pass `sender` in the options to set `{sender}`, which is the bot's name otherwise. When the module owns a button or menu of its own, such as one answered by its `components` handler, set `components: false` on the field and pass the row you built as `rows`, which is placed under the message's own. `files` attaches files. `mentions: { users, roles }` lists the ids the post may ping and nothing else; pass it when the text includes anything a member wrote, and empty lists for a post that pings no one. Without it a channel post may ping any user or role it mentions.

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

- **Messages**: anything sent to a channel, a direct message or an interaction, including an ephemeral refusal or error. Use `s.message` with the variables the text needs (`{role}`, `{limit}`) and a `help` that says when it fires. Put them in one `collapsible` group with `compact: true` on each, called "Replies and errors", with sub-groups by feature if there are many. A module with many messages can draw that group with `layout: "messages"` instead, as tickets does. Send through `ctx.send`, `ctx.reply` or `ctx.edit`, passing the default as `fallback`.
- **Short strings Discord limits**: modal titles and labels (45), placeholders (100), button labels (80), select options (100), channel names, topics, webhook names (80) and audit-log reasons (512). Use `s.string` or `s.template` with `max` set to Discord's limit and the placeholders declared, in a separate collapsible group called "Labels and text", or a group with `layout: "fields"`. Sanitise a channel name after its variables are filled in.

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

There are two areas. `moderation`: moderation and automod settings live on the Moderation Settings tab (`/guilds/:id/mod/settings` and `.../automod`). `tickets`: the tickets settings live on the Tickets Settings tab (`/guilds/:id/tickets/settings`), and the module's own address is the ticket inbox. Either way the old module pages lead there, and the sidebar doesn't list the module twice. The Settings tabs need Manage Server, which staff roles and ticket handler roles don't include.

Link to a module's settings with `moduleHref` from `apps/web/lib/module-href.ts`. It returns the hosted address when there is one.

## Rows

A setting that's a list of objects (feeds, role menus, reward tiers) is drawn as one row per entry. Owners can move a row up or down (the arrow buttons, Alt+Up and Alt+Down, or dragging its number) and duplicate it, which gives every generated id in the copy a fresh value. The stored order is the order on screen, so where row order matters to members, such as buttons, read the list in order. `rows` adds a status line and buttons to those rows without dashboard code. The key is the list's schema path without indices.

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

Both hooks see the settings as last saved, never a draft, so the dashboard disables the buttons while there are unsaved changes, and dims each row's last status as possibly out of date (a row that was edited shows none). A row arrives as a `RowRef`: its indexed path (`patchNotes.destinations[0].games[1]`), the row, and the object holding the list.

A `message` or a refusal from the bot is shown to the owner as it is when it reads as a sentence. Network error codes inside it (`getaddrinfo ENOTFOUND`, `ECONNREFUSED` and the like) are rewritten into plain words by the dashboard, but a module should still say what went wrong in its own words.

## Module actions

`actions` puts buttons on a module's settings page for things that are done to the feature as a whole, not to one row: posting a message, opening a sign-up. The shape is a row action without the row.

```ts
actions: {
  post: {
    label: "Post the verification message",
    help: "Puts the message in the channel above, or updates it.",
    input: s.object({ ... }), // optional; drawn as a form under the button
    async run({ ctx, input }) {
      return { ok: true, message: "Posted." };
    },
  },
},
```

The page runs an action against the saved settings, so it greys the buttons out while there are unsaved edits or the feature is off. `message` is shown to whoever pressed the button. The control API route is `POST /guilds/:id/modules/:moduleId/actions/:actionId` with `{ input }`, and `describe()` lists them as `actions`.

## Notices

`notices(ctx)` returns lines drawn above the settings form, for what depends on this server's saved state rather than the schema, such as the address of a page the module serves. Each is `{ tone: "info" | "attention", text, link? }`, where `link.href` is a dashboard path or a full address. The page reads them when it is opened and after every save. A hook that throws is logged and shows nothing.

```ts
async notices(ctx) {
  if (!ctx.settings.publicPage.enabled) return [];
  return [{ tone: "info", text: "The page is at https://bot.example.com/leaderboard/1." }];
},
```

## Unsaved changes on a dashboard page

Pages built from the schema already ask before an edit is lost. A page with a draft of its own (the Message creator, a settings screen written by hand) uses the same guard from `apps/web/lib/unsaved-guard.tsx`:

```tsx
const guard = useUnsavedGuard({ dirty, onSave: save, onDiscard: discard });
// render {guard.host} once in the page; navigate from code with
guard.confirmLeave(() => router.push(href));
```

While `dirty` is true, any in-app link (sidebar, tabs, buttons that are links), the browser's Back button and `confirmLeave` ask "Leave without saving?" with Stay, Discard changes, and Save and leave when `onSave` is given. `onSave` resolves true once saved; false keeps the person on the page. Closing the tab still gets the browser's own prompt. Mark a link `data-unsaved-guard="ignore"` to let it through.

## Commands

Command names are unique across all modules, and the registry throws on a duplicate at startup. A command whose reply an owner may rewrite declares `response: { starting, placeholders }`. `starting` is the message the editor opens with, written to match what the command says now, and each placeholder has a name, a description and a sample for the preview. In the handler, call `ctx.customReply?.({ ...values })` and send that when it isn't null; otherwise reply the way the command always has.

Commands are registered per server and re-synced, debounced by five seconds, when a module is toggled or an override changes.

Subcommands come from what `build()` registers: the registry lists them as `subcommands` on the command summary, keyed `command sub` or `command group sub` (`ticket close`). Each key gets its own `CommandOverride` row with `enabled`, `allowRoles` and the channel rules; the router checks the whole command first, then the part, and answers a part that is off with the `commandOff` system message. A part has no permission, visibility or reply of its own, and changing one doesn't re-register anything, since Discord can't hide a subcommand. A module needs nothing extra for this.

An option built with `setAutocomplete(true)` gets its suggestions from the command's `autocomplete(interaction, ctx)`, which answers with `interaction.respond`. It's only called while the module is on in that server, and the role and channel rules aren't checked since nothing runs. A command without it answers with an empty list.

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
| `messageDeleteBulk(messages, channel, ctx)` | a purge, once for the whole batch |
| `channelUpdate(before, after, ctx)` / `roleUpdate` / `guildUpdate` | a channel, role or the server's own settings changed |
| `threadCreate(thread, ctx)` / `threadDelete` / `threadUpdate(before, after, ctx)` | a thread is started, deleted, or archived, locked or renamed |
| `voiceStateUpdate(before, after, ctx)` | joining, leaving or moving voice, muting and deafening |
| `inviteCreate(invite, ctx)` / `inviteDelete` | an invite is made or deleted |
| `emojiCreate(emoji, ctx)` / `emojiUpdate(before, after, ctx)` / `emojiDelete` | an emoji is added, renamed or removed |
| `stickerCreate(sticker, ctx)` / `stickerUpdate(before, after, ctx)` / `stickerDelete` | a sticker is added, changed or removed |
| `auditLogEntry(entry, ctx)` | a new line in the server's audit log. The only way to see a kick. Needs View Audit Log |

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

A button sent by direct message arrives with no server. List its action in `directMessage` and start the id's rest with the server's id, and the router finds the server from that. The handler gets the whole rest, server id included, and still has to check that the person may act.

```ts
directMessage: ["rate", "rateComment"],

new ButtonBuilder().setCustomId(customId("tickets", "rate", `${ctx.guild.id}:${ticket.id}:5`));
```

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
