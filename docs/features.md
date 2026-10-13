# Features

## The short version

| Feature | What it does |
| --- | --- |
| Moderation | Warn, timeout, kick, ban and temporary bans, with numbered cases and role hierarchy checks. |
| Moderation dashboard | Member records, staff notes, actions from the web or Discord's right-click menu, statistics, a log of staff activity and CSV export. |
| Automod | Seven rules: invites, links, capitals, repeated text, mentions, banned words, rate limiting. |
| Tickets | A button that opens a private channel with your staff. |
| Welcome messages | Greetings, farewells and roles on join. |
| Role menus | Members pick their roles from buttons. |
| Log channel | Posts edits, deletions, joins, role changes and more into a Discord channel. |
| Leveling | XP, role rewards and a leaderboard. No image cards. |
| News and patch notes | RSS feeds and Steam patch notes, posted as embeds. |
| Messages | Build a message or embed, save it as a template, sort templates into folders and send it to any channel. |
| Bot messages | Every message the bot sends, from every feature, in one searchable list, each one editable. |
| Utility | Server and member info. |

Good to know:

- Every feature starts off. You switch them on per server, and it applies immediately with no restart.
- **Quick setup** in the sidebar gets a feature running with just the settings it needs.
- Moderators don't need Manage Server. The owner adds them under Moderation, then Access.
- Moderators can only use the dashboard if it's reachable from their devices. The [install guide](install.md#reaching-the-dashboard-from-other-devices) covers how.
- Only the owner can permanently delete a case or note. Anyone else's removal leaves a trace.

## In detail

Every feature is a module, and a module that's off does nothing. Most settings are optional. Leave one blank and that part stays quiet.

- [Quick setup](#quick-setup)
- [Commands](#commands)
- [Moderation](#moderation)
- [Moderation dashboard](#moderation-dashboard)
- [Automod](#automod)
- [Welcome messages](#welcome-messages)
- [Role menus](#role-menus)
- [Tickets](#tickets)
- [Log channel](#log-channel)
- [News and patch notes](#news-and-patch-notes)
- [Leveling](#leveling)
- [Utility](#utility)
- [Updates, changelog and what's coming](#updates-changelog-and-whats-coming)

## Quick setup

Quick setup in the sidebar asks only for the few settings a feature can't work without, one feature per screen, and switches the feature on at the end. **Moderation** and **Tickets** walk through several related features together, and every feature that has a quick setup is listed on its own below them.

Nothing is locked in. Settings it doesn't ask about keep their values, skipping a step leaves that feature as it was, and you can change anything later on the feature's own page. Features made of repeating rows, like role menus, have no quick setup.

![Quick setup asking for the few settings a feature needs](images/quick-setup.png)

## Commands

The Commands page lists every command on the server, including the right-click entries. Each one can be switched off, limited to certain roles and channels, or hidden from members without a chosen permission. You can also decide whether its reply is private or public, and for /ping, /serverinfo, /userinfo, /rank, /leaderboard, /warn, /kick, /ban, /unban and /timeout, write the reply yourself with the same editor as the [Messages](#messages) page: text, embeds, buttons, menus and variables, plus reactions on a public reply. The editor starts from what the command says now, and each command has its own variables, such as `{user}` and `{case}` for /warn. Discord can't hide a command by role, so the role list blocks use but doesn't hide it.

![The Commands page with a hidden command and role limits](images/commands.png)

![A command's settings sheet: who can use it, where, and its reply](images/command-sheet.png)

## Messages

The Messages page builds messages and embeds for the bot to post, such as rules, announcements or event notices. You edit on the left and see the message drawn the way Discord shows it on the right.

![The Messages page with a saved template, its live preview and the editor](images/messages.png)

What you can set:

- Message text, with buttons for bold, italic, underline, strikethrough, code, spoilers and quotes.
- Up to 10 embeds. Each has a color, an author with icon and link, a title with a link, a description, up to 25 fields (inline or not), an image, a thumbnail, a footer with an icon, and a time in the footer. The time can be none, the moment it's sent, or a time you pick.
- Up to 25 buttons, five to a row. Each has a label, an optional emoji, a color (blue, grey, green or red) and an off switch that greys it out. A link button opens a web address. The others do something when pressed, which you choose.
- Up to 5 menus, each on a row of its own: a list of your own choices, or a picker for members, roles, members or roles, or channels. A menu sets how few and how many can be picked, a placeholder, whether it's off, and for a channel menu which kinds of channel appear. Each of your own choices has a label, a description, an emoji, and whether it starts picked.
- Up to 20 reactions the bot adds under the message.

A button, a choice, or a member, role or channel menu can do nothing, reply, or give or take a role. A reply is built with the same text and embeds as a message, with `{user}`, `{user.mention}` and `{selected}` filled in for the person who used it, and is private by default. A role action gives the role, takes it away, or toggles it, and can say something back. The bot can only change roles below its own highest role.

What a message's buttons and menus do is saved when the message is sent, so editing the template later doesn't change a message that's already out.

Above each text box there are tools to insert:

| Tool | What it adds |
| --- | --- |
| Variables | A name in braces that the bot fills in when it sends: `{server}`, `{members}`, `{channel}`, `{channel.name}`, `{date}`, `{time}`, `{now}`, `{sender}` and `{bot}`. The preview fills them in with stand-ins. |
| Time | A Discord timestamp. You pick a date, time and style (short time, long date, relative and so on), and each reader sees it in their own timezone. |
| Mention | A role, a channel, @everyone, @here, or a member by user ID. |
| Emoji | Your server's custom emoji and a set of common ones. |

Name a message and press Save to keep it as a template. Folders group templates, one level deep. Deleting a folder moves its templates out and deletes nothing.

Send posts it to the channel you pick, after a confirmation that shows the message once more. The bot needs View Channel and Send Messages there, and Embed Links for an embed. Each send has its own options: send under another name and picture (through a webhook, which needs Manage Webhooks in that channel), send silently, pin it, publish it to followers of an announcement channel, hide link previews, read it out loud, start a thread on it, and reply to a message. These are chosen when you send and aren't saved with the template.

A sent message can mention people and roles. @everyone and @here only ping when you turn on "Let @everyone and @here ping" for that send, and Discord still ignores them unless the bot has the Mention Everyone permission.

### Messages the bot sends by itself

Where a feature has a message that is a setting, it shows a small preview of the message and an **Edit message** button instead of a text box. The button opens the editor from the Messages page: text, embeds, buttons, menus, reactions and variables, with a preview beside it. The editor starts from what the bot sends now, so you can change one word without rebuilding anything. Nothing is kept until you press **Use this message** and then Save on the settings page.

A variable is a name in braces that the bot fills in when it sends, like `{user}` or `{level}`. The Variables tool lists the ones that message understands first, then the ones every message has. **Go back to the default** puts the original wording back.

Almost everything the bot posts or sends works this way: the punishment DM and the mod log post, automod notices and log posts, welcome and farewell messages and their DMs, level-up announcements, the ticket panel and the messages around a ticket, role menus and their replies, news and patch note posts, and each kind of log channel entry. Slash command replies are edited from the Commands page. The replies the bot gives on its own account, such as a command that is switched off or a failure, are edited on the [Bot messages](#bot-messages) page.

Messages written before the editor existed are kept and show up as plain text in it. If an edit ends up too long once the variables are filled in, the bot sends the default instead of nothing. Buttons and text menus work in a direct message too. Menus of roles, channels or people do not, and reactions are dropped. A role button in a direct message changes the role on the server the message came from.

## Bot messages

The Bot messages page lists every message the bot sends, from every feature, in one place. Use it to find a message without knowing which feature it belongs to, or to see all the wording on a server at a glance. It's in the sidebar under Messages.

Each row has the message's name, a line saying when the bot sends it, the first line of what it says now, and an **Edit message** button. The button opens the same editor as the settings pages, and the message is saved the moment you confirm it, with no separate Save. A message you've changed has an **Edited** tag. **Go back to the default** puts the original wording back.

- **Search** looks at a message's name, when it is sent, the feature it belongs to and the words it says now. Every word you type has to match, in any order. Press `/` to jump to it.
- The feature list narrows the page to one feature, and **Edited only** shows just what you've changed.
- A feature that's switched off still lists its messages, dimmed, so you can write them before you turn it on.
- Command replies are listed too, under **Command replies**. They open the same editor as the Commands page.
- **Open in settings** on a row goes to the message on its feature's page. Short pieces of text that aren't messages, such as a channel name, a button label or the reason in the audit log, aren't on this page. They are under **Labels and text** on the feature's page.

The first group, **Bot replies**, belongs to the bot itself rather than to a feature. It has no switch and is always on. Under **Replies and errors** it holds what members are told when a command's feature is switched off, when a command is turned off in a channel or limited to roles they don't have (`{roles}` lists the allowed ones), and when a command fails. It also holds what a role button or menu says when the role no longer exists, sits above the bot's own, can't be changed, or was given or taken away, when a message's buttons are no longer active, and when a button, menu or form stops with an error. A button's own confirmation, if you wrote one, is used instead of the server's usual one. Each is shown only to the person it answers.

Under **Labels and text**, **Bot replies** also holds the name shown for a role or channel that no longer exists in a limited menu, the name of the webhook used when a message is sent under another name, who a message from the dashboard says it is from when you don't give a sender (`the dashboard` to start with), and the reason written to Discord's audit log when removing a case on the dashboard lifts a timeout (`Case #{case} removed by {actor}`).

Every message starts as the wording the bot has always used. If your wording no longer fits Discord's limits once its variables are filled in, the bot sends the original instead of nothing.

## Moderation

Warnings, timeouts, kicks, bans and temporary bans. Each gets a numbered case you can look up later.

- **Role hierarchy is checked before anything is sent to Discord.** A moderator can't act on someone whose highest role is at or above theirs, the bot can't act above itself, and nobody can act on the server owner. You get a refusal that says why.
- **A temporary ban schedules its own unban.** It's stored in the database, so a restart doesn't leave someone banned. Unban by hand first and the pending one is dropped.
- **Discord's limits apply.** Timeouts cap at 28 days, and bulk delete can't touch messages older than 14 days.
- **Cases outlive the action.** Unbanning keeps the row, marked inactive.
- **Every action checks who is asking.** A slash command, the right-click menu and the dashboard all need the Discord permission for the action or a staff role that covers it, whatever the command's visibility is set to in Discord. Nobody can act on themselves, on the bot or on the server owner. `/case` and `/history` are for staff, like the right-click **Member history**.
- **Nothing is sent before Discord can do it.** The bot checks that it can time out, kick or ban the member, and refuses with a reason if not, so nobody is told they were banned by a ban that could not happen. If Discord still refuses after the member was messaged, they get a short correction.
- **Only members are messaged.** Someone who is not in the server, such as a user id banned ahead of time, is never sent a direct message, except that a confirmed ban being lifted still tells its member.
- **A temporary ban that cannot be lifted is tried again.** If Discord refuses the unban, the bot tries again after 1, 5, 15 and then every 60 minutes for a day, and only records the unban and messages the member once it has worked. A ban someone already lifted by hand is closed on the record without a message. Work waiting on a server the bot has not loaded yet, or on a feature that is switched off, waits instead of being dropped.
- **`/purge` is written to Staff activity.** Who deleted how many messages in which channel. It is not posted to the mod log, because that post is built around a case and a member.
- **The reason goes to the member as written.** The reason a moderator types is both the note on the case and the text in the member's direct message. Leave anything meant only for staff out of it. The default message does not name the moderator; `{moderator}` and `{moderatorId}` are there if you want them.

A mod log post can carry a **View in dashboard** button that opens that case on the member's record, scrolled to and highlighted. The address in the link is learned from the instance owner: whenever the owner has the dashboard open, its address is saved, and an address that only works on the same machine, such as `localhost`, is replaced as soon as the owner opens the dashboard on a real one. If the link is wrong, for example behind a proxy that hides the real address, type it into **Dashboard address** in the moderation settings, which takes priority over the saved one. Until one of the two exists the button is left off the post. The same button is on the posts automod makes and on the stock `/case` reply. The link only works for moderators who can sign in to the dashboard; anyone else gets the usual access refusal.

A case that staff removed in the [moderation dashboard](#moderation-dashboard) is hidden from `/history` and `/case`. The row stays in the database and shows in the dashboard, marked as removed.

### Wording you can change

Everything the module posts or sends on its own can be rewritten with the message editor (see [Messages the bot sends by itself](#messages-the-bot-sends-by-itself)). On the module's settings page:

- **Direct message to the member** is what a member is sent when action is taken on them, if **Direct message the member when action is taken** is on. One message covers every action, because `{action}` becomes warned, timed out, kicked, banned, unbanned or timeout cleared. Besides the variables every message has, it understands `{action}`, `{actionTitle}` (the same with a capital), `{reason}` (or "No reason given"), `{reasonNote}`, `{expires}`, `{expiresRelative}`, `{expiryNote}`, `{duration}`, `{moderator}` and `{moderatorId}`. `{reasonNote}` is " Reason: " and the reason, and `{expiryNote}` is " This expires " and the time, each with its leading space, and both are empty when there is nothing to say. The default message is `You were {action} in {server}.{reasonNote}{expiryNote}`. The moderator is not named unless you add `{moderator}`. Buttons work, including ones that open a web address, which suits an appeal link. Reactions and the role, channel and user menus are dropped, because a direct message can't carry them.
- **Mod log post** is the embed posted in the mod log channel. It understands the same variables plus `{case}`, `{member}`, `{memberId}`, `{created}`, `{caseUrl}` (a link to the case in the dashboard) and `{memberUrl}` (a link to the member's record). An embed field whose variable is empty is left out, which is how the default leaves the Expires line off warnings and kicks. A link button whose address comes out empty is left out the same way, which is how the default **View in dashboard** button (`{caseUrl}`) disappears until the bot knows the dashboard's address. The direct message to the member never has these two.

The replies to `/case`, `/history`, `/purge` and the right-click **Member history** are edited on the Commands page, as the replies to `/warn`, `/timeout` set, `/kick`, `/ban` and `/unban` already are. `/history` fills in `{user}`, `{count}` and `{list}`, where `{list}` is one line per case. `/purge` fills in `{count}`, `{messages}` and `{skippedNote}`. `/case` uses the mod log variables plus `{reversedNote}`, which says when the action has since been reversed.

Two collapsed sections lower on the settings page hold everything else the module says in Discord. Each starts with the wording the bot has always used, so nothing changes until you edit it.

- **Replies and errors** has one short message for each thing a moderator can be told, grouped by when they see it. *Actions that are refused* covers a missing reason, a reason or length that is too long, a length that can't be read, acting on yourself, the bot or the server owner, not being allowed to take the action, a member who outranks the moderator or the bot, a member who isn't in the server, a member who is already banned or isn't banned, an action Discord would refuse, and an action Discord refused after the member was messaged. *Staff checks and the right-click menu* covers someone who isn't on the staff list, an action only admins may take, a message with no member behind it, picking yourself or the bot in the menu, and a form that is out of date. *Cases and history* covers a case number that doesn't exist and a member with no history. *Purge* covers the four ways `/purge` can fail to run. *Confirmations* has the reply to `/timeout clear` and the confirmation shown after a right-click warn, timeout, kick or ban, which can use `{name}`, `{case}`, `{notes}` and, for a timeout, `{until}` or, for a ban, `{expiry}`. *Direct messages* has the correction a member is sent when an action they were told about didn't happen. Each message says when it is shown, and lists the values it can use, such as `{name}`, `{max}` or `{verb}`.
- **Labels and text** holds the short pieces the messages are built from: what each action is called (Warned, Timed out and so on, and "No reason given"), the phrases that complete "You are not allowed to ... here" and "I could not ...", the sentences added after an action ("They are not in the server, so the ban stops them from joining again"), how lengths of time are written, how a line of `/history` is laid out, how `/purge` counts messages, the titles, boxes and hints of the right-click forms (each limited to what Discord allows, shown as you type), and the reason the bot gives when it lifts a temporary ban. These names also appear in direct messages and the mod log, because they fill in `{action}`, `{reason}` and the like. The dashboard keeps its own names and its own error messages.

Two kinds of text can't be edited from here. The names and descriptions of the commands and of their options are registered with Discord and can't be changed after the fact. The lines the bot writes to [Staff activity](#staff-activity) are shown in the dashboard, not in Discord. If an edited message ends up too long once the variables are filled in, the bot sends the default one instead.

## Moderation dashboard

The Moderation area in the sidebar is where staff read a member's record, leave notes, take back a mistaken action and see how moderation is going. It shows the cases the moderation and automod features record, so there's nothing extra to switch on.

| Tab | What it's for | Who sees it |
| --- | --- | --- |
| Overview | Statistics | Staff |
| Members | Everyone with something on file | Staff |
| Actions | The log of every case | Staff |
| Audit | What staff have changed | Admins and the owner |
| Access | Who can use all of this | The owner |
| Settings | Moderation and Automod settings | Anyone with Manage Server |

A search box in the header finds a member from any tab. Press Ctrl+K (Cmd+K on a Mac), or `/` when you're not typing in a field.

![The Overview tab: totals, actions per day and a breakdown by type](images/moderation-overview.png)

### Who can use it

- **The owner of the install** is the first account that signed in, or the user ID in `INSTANCE_OWNER_ID`. The owner can use Moderation on every server the bot is in.
- **Everyone else** can use it only on servers where the owner has added them, as a Moderator or an Admin. The owner does that on the Access tab, by name or Discord user ID, even before the person has opened the dashboard.
- **Manage Server** doesn't make someone staff. It opens the Settings tab and nothing else under Moderation. Being staff doesn't give access to a server's settings either.

| Permission | Moderator | Admin | Owner |
| --- | --- | --- | --- |
| Read member records and statistics | Yes | Yes | Yes |
| Write notes | Yes | Yes | Yes |
| Warn, time out, end a timeout | Yes | Yes | Yes |
| Edit a case | Their own | Any | Any |
| Take a warn or timeout off a record | Yes | Yes | Yes |
| Kick, ban, unban | No | Yes | Yes |
| Read staff activity, export member actions as CSV | No | Yes | Yes |
| Open the server logs | If the owner allows it | Yes | Yes |
| Delete the server logs | No | Yes | Yes |
| Edit or delete others' notes, restore deleted notes | No | Yes | Yes |
| Put a removed action back | No | Yes | Yes |
| Take a kick, ban or unban off a record | No | No | Yes |
| Purge an action or note permanently | No | No | Yes |
| Choose who has access | No | No | Yes |

Anyone can edit or delete their own notes.

### Member records

The Members tab lists everyone with an action or note on file. You can filter to members who are restricted right now, have notes, or were acted on in the last seven days. A member's page shows their roles, join date and account age, and a timeline of actions, notes and (for admins and the owner) staff activity, each labeled with what it is.

Notes are for staff only. Members never see them and the bot never sends them to Discord. A note is up to 2,000 characters and a member can carry 200.

Nothing disappears from the timeline when it's removed. A removed action or deleted note stays in place, marked with who removed it and when. Admins and the owner can still read a deleted note. A moderator sees that it was deleted and by whom, but not the text.

![The Members tab listing everyone with a record](images/members-list.png)

![A member's page with their timeline and a box to add a note](images/member-profile.png)

### Taking action

The **Take action** button on a member's page offers what your level allows, and only what fits the member. Unban shows for someone banned, Clear timeout only while a timeout is running. Each choice opens a short form with a reason (up to 500 characters, and required if the Moderation setting says so) and, for timeouts and bans, a length. A ban can also delete up to 7 days of the member's messages.

Warns, timeouts, kicks and bans also have an **Attach messages** section. It lists the member's latest messages in any channel you can read, deleted ones included, and you tick the ones that belong on the case (up to 10). You can also paste a message link for one that isn't listed. Attached messages show on the case in the member's timeline and under Member actions. The list comes from the Messages part of [Server logs](#server-logs) when that is on. Without it, the bot only remembers the last three days in memory, and that is empty after a restart, so a link is the way to attach anything older. A message that was edited has a dropdown with every version, and the case keeps all of them. Once you tick it, choose which version broke the rules, the original or any edit. The case shows that version first, marked as the one the member was warned for, with the rest under the dropdown. This works the same for a message that was edited and then deleted. A deleted one carries a red Deleted label. File names are kept, but the files stay on Discord and their links can stop working. CSV exports include the links only.

It runs the same code as the slash commands, so it behaves the same: hierarchy check, direct message if that setting is on, the Discord action, the case, the unban schedule for a temporary ban and the mod log post. The case names you as the moderator.

![The warn form with a reason and what will happen](images/take-action.png)

Refused with a message that says why:

- The Moderation feature is off, or the action's command is switched off on the Commands page.
- The target is the server owner, outranks you, or (for anything that changes Discord) outranks the bot. A warning only writes a record, so the bot's position doesn't stop one.
- The target is you or the bot.
- You aren't a member of the server, since your roles can't be compared. The install owner is the exception.
- Another action on that member is still running, or you've taken 20 actions in a minute.
- A ban longer than 3,650 days. Leave the length empty for a permanent ban.

A member who has left can still be warned, banned and unbanned. A warning on them is a record only. The dashboard never sends a direct message to someone who isn't in the server, except on an unban.

### The right-click menu in Discord

With Moderation on, staff can act without opening the dashboard. Right-click (or long-press) a member or a message, choose **Apps**, and pick an entry.

- On a member: Warn member, Timeout member, Kick member, Ban member, Member history.
- On a message: Warn author, Timeout author, Kick author, Ban author.

Actions open the same form as the dashboard. From a message, the message itself is attached to the case: its text, channel, time and any file names, copied as they read when you acted. The copy stays readable if the member edits or deletes the original. If the bot never saw the message, only a link is added to the reason.

Discord shows an entry only to members with the matching permission: Timeout Members for warn, timeout and history, Kick Members for kick, Ban Members for ban. Seeing it isn't enough. The person also has to be on the staff list or be the install owner, with the same levels as the dashboard. If a moderator can't see the entries, give their role Timeout Members. Server owners can change who sees each entry under Server Settings, Integrations. Each entry is also a command on the Commands page, so it can be switched off or limited like any other.

### Editing a case

Open a case on the member's page and choose **Edit case**. You can change the reason, the attached messages (remove one, add one, or choose which version of an edited message the member was warned for), and, while a timeout or ban is still running, how long it lasts. A new length counts from now and is applied in Discord straight away, including making a ban permanent. A timeout or ban that has already ended can't have its length changed.

![The Edit case dialog, choosing which version of an edited message broke the rules](images/edit-case.png)

![A case marked as edited, with the version the member was warned for](images/member-case.png)

Moderators can edit their own cases, admins and the owner any case, including automod's. Changing the length of a ban needs the same level as banning. A case that was removed from the record has to be restored first.

An edited case shows a blue **Case edited by staff** note with who and when, on the member's page and in Member actions. That is different from the amber **Message edited** label inside an attached message, which means the member changed their own message. Staff activity records every edit with what it said before and after, and each case has a **See everything staff did on this case** link, which Member actions also offers as **Staff activity** next to **Profile** on every row. The post in the mod log channel and any direct message already sent keep the old text.

### Removing, restoring and purging

Three levels, each stronger than the last.

**Remove from record** keeps the entry on the timeline, struck through, with your name, the time and a required reason. It stops counting in totals, statistics, `/history` and `/case`. Moderators and admins can remove warns and timeouts (automod's included). Only the owner can remove a kick, ban or unban. Removing a timeout that's still running also lifts it in Discord, unless the member has left, the bot ranks below them, or another timeout on them is still in force.

**Restore** puts a removed action or deleted note back. Admins and the owner can. It never contacts Discord, so a restored timeout isn't reapplied and a restored ban isn't repeated.

**Purge forever** is for an entry that shouldn't exist at all. Only the owner can, after typing `purge`. It deletes the entry and every audit entry about it, and leaves no trace. It can't be undone. SQLite may keep the deleted bytes inside `tier0.db` until they're overwritten, and older backups still contain it, so it isn't secure erasure. The `/purge` command that bulk deletes messages is unrelated.

Case numbers are never renumbered or reused. Purging case 12 leaves a permanent gap, and no later case gets 12.

![The dialog for removing a case from a record, with a required reason](images/remove-from-record.png)

### Server logs

The Server logs tab is a searchable record of what happened in the server, so staff don't have to scroll channels or Discord's own audit log to find it. It's off until you turn on the **Server logs** feature. Choose what to record in its settings, which you reach from the **Settings** button on the tab:

![The Server logs Events view with category filters and counts](images/server-logs.png)

- **Members:** joins, departures, nickname changes and role changes.
- **Messages:** every message members post, every edit and what was deleted, including messages removed by /purge. Bots are left out.
- **Moderation:** bans, unbans, kicks and timeouts, from any source, with who did it when Discord says.
- **Roles:** roles created, changed (name, colour, permissions) and deleted.
- **Channels:** channels and threads created, changed (name, topic, category, slowmode, permissions) and deleted.
- **Voice:** joining, leaving and moving between voice channels, and being server muted or deafened.
- **Server:** server settings, invites and emojis.

Who did something comes from Discord's audit log, so the bot needs the View Audit Log permission, which the invite link already asks for. Without it the log still works and entries just don't say who.

The tab has two views. **Events** is the timeline of everything above. Every filter applies as soon as you change it and shows as a chip you can take off:

- Search any text: names, channels, summaries, and what was said in edited and deleted messages.
- Category chips, with how many entries each has under your other filters. You can pick several.
- **Event types**, to pick exact events such as "Roles changed" and "Joined voice".
- A member, by name or ID. It matches who did something and who it happened to. Clicking a name in an entry filters to that person.
- A channel, and a date range with shortcuts for today, 7 days and 30 days.

An entry's **Details** show what changed, before and after.

![Entries opened to show what changed, with a button for the message's history](images/server-logs-details.png)

![The date range picker, with shortcuts and a calendar](images/server-logs-dates.png)
 A message entry links to the message with all its versions. The filtered view is in the address, so you can bookmark it or send it to another moderator.

**Messages** is the saved text itself.

![The Messages view with filters, a deleted message and an edited one](images/server-logs-messages.png)
 Search by words, member, channel and dates, and show only deleted or edited messages. A search also matches earlier versions, so an edited message is found by what it said before. Deleted messages are labelled in red, with who deleted them when the bot could tell: the author, a moderator, Automod or the bot. Moderator deletions need the **View Audit Log** permission. Discord records nothing when members delete their own messages, so with no matching audit entry the message is shown as deleted by its author. Messages deleted before this was recorded, or ones the bot never saw, are just labelled Deleted. Edited messages have a dropdown with each version. A message with no text says what it did carry, such as a file or a sticker. Tick messages from one member and choose **Take action** to open the action form with them already attached.

Staff only see channels they can read in Discord, so the logs can't be used to get into a private channel. Admins and the owner can always open the tab. Moderators can if you switch on **Let moderators open the server logs**.

The logs are stored in this installation's database, not on Discord, and Messages holds everything members type, so tell your members. You choose how many days to keep (30 by default) and old entries are deleted automatically. You can leave channels out, such as private staff ones. Switching a kind off, or the feature off, stops saving but doesn't delete what's there. **Delete the logs** on the tab does, for everyone, and is recorded in Staff activity. Files members attach aren't copied: Messages keeps their names and links, which stop working when Discord removes the file.

A server that already had the message log on keeps it, now as the Messages part of Server logs with the same days and settings. The other kinds start off for those servers.

### Staff activity

The Mod logs tab has two pages with a switch at the top: Member actions and Staff activity. Staff activity is for admins and the owner and lists every change made through the dashboard: actions taken on a member (warn, timeout, kick, ban and so on), notes added, edited, deleted or restored, actions removed or restored, and staff added, changed or removed. The owner's changes are included. Actions taken from Discord, with a slash command or the right-click menu, are on the member's record and in the Actions tab but not here, and actions taken before this was added aren't listed. Automod's cases are listed too, as Automod, with what it did and the case number; the message it acted on stays on the case. Choose Automod in the staff member filter to see only those. Purges are listed as well. Entries show who did it and at what level, and edits and removals expand to show before and after. You can filter by type, staff member, member ID, date range and words. The same entries appear on a member's timeline as staff activity.

Cases made by commands and automod are the actions themselves, under Member actions.

![Staff activity listing what staff changed](images/staff-activity.png)

### Statistics

The Overview tab covers 7, 30 or 90 days, in UTC, ending today. The tiles count actions (excluding removed ones), warns, timeouts, kicks and bans, removed cases and notes written. Each compares with the previous period of the same length, and a fall in actions, warns, timeouts or kicks and bans shows as an improvement. The comparison only appears when there's older data to compare with.

Below the tiles:

- **Right now:** timeouts and bans in force, and members with anything on record. Not limited to the range.
- **Repeat actions:** the share of members actioned again within 30 days of an earlier action. It appears once at least five members were actioned. Automod, unbans and cleared timeouts don't count.
- **Automod:** what automod's rules did in the range, which rules fired most, and a link to Member actions filtered to automod.
- **Busiest hours:** actions by hour of the day, in UTC.
- **Moderators:** who acted, how much, and when they last did. Selecting a name opens Member actions for them.
- **Most actioned members:** the ten with the most actions.

### Member actions

Member actions, on the Mod logs tab, lists every case, newest first. You can filter by type, state (in force, expired, removed or on record), source (manual or automod) and moderator, and search the reason, a case number or a member ID. It doesn't search by name.

![Mod logs, with the switch between Member actions and Staff activity](images/mod-logs.png)

Admins and the owner can export the current filter as a CSV, newest first, up to 5,000 rows. Removed entries are included. Names are looked up from Discord, so the oldest cases in a large export can have blank names, and the ID columns are always filled in. Cells that start with `=`, `+`, `-` or `@` get an apostrophe in front so a spreadsheet won't treat them as formulas. Strip it if you load the file anywhere else.

### Access tab

The owner adds staff to a server, switches them between Moderator and Admin, and removes them. Bots can't be added. Removing someone takes away their access and nothing else. Their notes and actions stay. Every change is in Staff activity.

![The Access tab with staff levels and who added them](images/access.png)

### Danger zone

The owner has a **Danger zone** tab that no one else sees. It deletes whole logs for good: Member actions (every case on every record), Staff activity, the Server log events and the saved messages. Tick any number of them, then hold the button for three seconds while a red bar fills it, so a stray click does nothing. Letting go early cancels. One entry is left in Staff activity saying who deleted what.

![The Danger zone with two logs ticked and the hold button](images/danger-zone.png)

### Settings tab

Moderation and Automod settings live here, with a switch at the top to move between them. They're the usual settings forms, and the old pages for them redirect here. Opening the tab needs Manage Server, which a staff role doesn't include.

![The Moderation settings on the Settings tab](images/moderation-settings.png)

### Sidebar

The sidebar shrinks to a strip of icons with the button in its header or Ctrl+B (Cmd+B). The browser remembers it per browser, not per account. On a phone it's a drawer.

![The sidebar collapsed to icons](images/sidebar-collapsed.png)

## Automod

Seven rules you switch on separately, each with its own actions and exemptions: invites, links, capital letters, repeated text, mention limits, banned words and rate limiting. Every rule starts off, so switching the module on does nothing until you pick some.

![Automod settings with one card per rule](images/automod-settings.png)

Banned word matching is conservative on purpose. Text is lowercased, common letter-for-number swaps are folded back, a letter stretched out three or more times is collapsed, and it matches on word boundaries. So `assassin` doesn't trip a rule for the rude three letters inside it. The cost is that spacing letters out gets past it, since catching that means stripping whitespace, which glues unrelated words together and brings the false positives back. Missing a few real cases beats deleting innocent messages.

Anyone with moderator permissions is exempt by default, and you can turn that off. When several rules trip on one message, only one rule acts: the one whose actions are most severe, meaning it times the member out, then warns, then only deletes, and the first rule listed wins a tie. Its actions are used as they are and never added to another rule's. A message in a thread follows the channel the thread is in, so exempting a channel exempts its threads too.

Each rule is a section that starts closed, with what it does written on its header and its On switch beside it, so you can look down the page without opening anything. **Expand all** opens every rule at once. Inside, the **What to do when it trips** list takes any combination of three things. **Delete** removes the message. **Warn** adds a warning to their record and leaves the message where it is. **Time out** mutes the member for the rule's timeout length, which only shows while that is ticked. It leaves the message where it is too. Pick delete as well if the message should go. A rule needs at least one. Each option in the list says what it does, and the suggested ones are marked. They are also what a rule does until you change it:

| Rule | Suggested |
| --- | --- |
| Invites | Delete, warn |
| Links | Delete |
| Excessive capitals | Delete |
| Repeated text | Delete, warn |
| Mass mentions | Delete, time out |
| Banned words | Delete, warn |
| Rate limit | Delete, time out |

Rules saved before this was a list keep doing exactly what they did. A rule set to delete still only deletes, one set to warn only warns without deleting, and the old "delete the message and time the member out" became delete plus time out.

What each rule reads:

- **Invites** looks for `discord.gg/code` and `discord.com/invite/code`. Allowed invites can be a bare code or a pasted link, with or without a query string.
- **Links** looks at the address of every `http` or `https` link. Allowed domains can be pasted as a whole link, such as `https://youtube.com/watch?v=1`, and only the domain is used. A domain also covers its subdomains. A link whose address isn't a valid domain (stray symbols, or a name followed by `@`) counts as not allowed.
- **Banned words** matches whole words in any alphabet, so a Cyrillic or accented word works, and punctuation next to a word doesn't hide it (`damn!`). The record and the log post list which entries of your list matched, not the member's whole message.

Automod reads edits as well as new messages, since an edit is an easy way past a filter. An edit is only checked when its text changed, and it doesn't count as another message toward rate limiting or repeated text. A message is acted on once, even if Discord sends several updates for it.

Automod only reports what it managed to do. If the bot can't delete a message, or can't time a member out because they're an administrator, the owner, or above the bot, the notice and the record say only what actually happened, and the log post gets a **Not carried out** line saying what failed. A timeout that didn't go through is recorded as the warning or deletion that did, not as a timeout. Each trip is one case, filed under the strongest thing that happened (time out, then warn, then delete), however many actions the rule has.

Messages never repeat what the member wrote. The reason in the notice, the log and the record is fixed wording such as "Posted a Discord invite link". The specific invite code, domain or banned word that matched goes only to staff, in the **Matched** field of the log post and in the record on the dashboard.

Each trip also keeps the message itself on the case, as a moderator's attached message is kept: its text, channel, attachments and a note of whether it was deleted. If the member edited it into breaking the rule, the earlier versions are kept as well, from Server logs when that is on, and the version that tripped the rule is marked. It is kept even when the bot couldn't delete the message. This is staff-only and shows on the member's record in the dashboard, never in Discord. The log post carries the **View in dashboard** button, which opens the case. Automod's cases have case numbers like any other, and each one has a line in [Staff activity](#staff-activity) saying what automod did. Cases from before this was added get their line the next time the bot starts. The notice can only mention the member it is about, and the log post mentions no one.

### Wording you can change

Three things automod says are edited with the message editor, and a section of small pieces sits below them.

- **Notice in the channel** is posted where the message was removed and deleted again after the time in **How long the notice stays**: 8 seconds unless you change it, up to 5 minutes, anything under 2 seconds is taken as 2, and `0s` leaves the notice up. Besides the variables every message has, it understands `{user}` (a mention), `{userId}`, `{rule}`, `{ruleKey}` (the rule's own name, `rateLimit` for example, whatever `{rule}` is set to show), `{action}` (what was done: delete, warn, timeout, or several such as delete and warn), `{reason}`, `{reasonNote}`, `{outcome}` and `{duration}`. `{reasonNote}` is a colon, a space and the reason, or nothing. `{outcome}` is chosen from what actually happened, for example your message was removed, you were timed out, your message was removed and you were warned, or your message was removed and you were timed out. When all that happened was a warning, it says that message tripped automod. The default is `{user}, {outcome} ({rule}{reasonNote}).`
- **Log posts** are the embeds sent to the log channel, one for each thing a rule can do (delete, warn, time out) so that each keeps its own colour. A rule that does several things uses the post for the strongest one that happened. They understand the same variables except `{outcome}` and `{reasonNote}`, plus `{match}` (the invite code, domain or banned words that matched, in code blocks so nothing becomes a link), `{problems}` (what the bot couldn't do), `{case}`, `{caseUrl}` and `{memberUrl}`. The default post shows these as **Matched** and **Not carried out** fields, which are left out when empty. `{match}` and `{problems}` aren't available in the channel notice. `{reason}` is a dash when there is nothing to add.

- **Direct message to the member** is off until you turn on **Also message the member privately**. It goes to the member whose message tripped a rule, so they know why without the channel seeing, and it carries the same fixed reason as the notice and never what they wrote. The default is `In {server}, {outcome} ({rule}{reasonNote}).` It understands `{user}`, `{userId}`, `{rule}`, `{ruleKey}`, `{action}`, `{reason}`, `{reasonNote}`, `{outcome}` and `{duration}`. It mentions nobody, and a member with direct messages closed is skipped.
- **Labels and text** is a collapsed section at the bottom. It holds how each rule is named in `{rule}` (by default the rule's own name, as the notice has always shown it, so "rateLimit" rather than "Rate limit"; type the name you want members to see), the reason given for each rule, the eight phrases `{outcome}` is chosen from, the words `{action}` joins (delete, warn, timeout, and the comma and "and" between them), the dash used when there is no reason, the four lines that say what the bot couldn't do, the reason written to Discord's audit log when a member is timed out (`Automod: {rule}`), and how lengths of time are written. The case on the dashboard keeps the rule's own name, whatever you call it here.

Both are shown on the module's settings page, and the log posts only when a log channel is set. A message that comes out too long once filled in is replaced by the default. The automod lines in [Staff activity](#staff-activity) are shown in the dashboard and aren't editable here.

## Welcome messages

Greetings on join, farewells on leave, an optional direct message to each, and roles given on arrival. The greeting and the farewell are posted in the channel you pick, and nothing is posted while that is empty. Each of the four messages is edited with the message builder, so it can be an embed, carry an image or use any of the other variables. They start as a short line you can change. Besides the variables every message has, they understand `{user}` (a mention), `{username}`, `{server}` and `{memberCount}`. The two direct messages are off until you switch them on, and are only sent if the member allows DMs. A message you wrote before the builder existed is kept, and one that was set to send as an embed becomes an embed with the same text. These four are all the module says, so there is no other wording to change. The bot can't give a role above its own. It logs that and carries on with the rest of the join.

![Welcome message settings with a live preview](images/welcome-settings.png)

## Role menus

Members pick roles from buttons on a menu you publish to a channel. Buttons keep working after the message leaves the bot's cache, need no message content permission, and give the member a private confirmation. Publishing a menu again edits the existing message. Mark a menu exclusive and picking one option clears the others, which suits a rank or a main platform.

The message above a menu's buttons is edited with the message builder, with `{menu}` for the menu's name. The buttons themselves come from the menu's options and are added under whatever you write, so the builder doesn't offer buttons for it. A menu saved with a title and description keeps them as an embed. Under **Replies** you can reword the private confirmations: one when a role is given and one when it is taken away, both with `{role}` and `{menu}`, and the one `/rolemenu` shows after publishing a menu, with `{menu}` and `{menuChannel}`. The refusals are there too, and also private: a menu name `/rolemenu` can't find (`{name}`), a menu whose channel was deleted, a menu the bot couldn't post or update, a button on a menu that was removed, a button whose role was taken off the menu, and a role above the bot's own (`{role}` and `{menu}`). The whole group is called **Replies and errors**.

![A role menu being edited with its options](images/role-menus.png)

## Tickets

A panel with a button. A member presses it, gives a subject and gets a private channel with your support team. The channel denies the whole server and grants access back to the opener, your support roles and the bot, whatever other roles anyone has. Transcripts (sent to a channel you pick when the ticket closes) and auto-close (the clock resets when anyone speaks) are optional. A member who's hit their ticket limit is told so.

The panel, the first message inside a new ticket, the transcript post and the short replies are all edited with the message builder, and each starts as what the bot posts now. The button on the panel and the Close ticket button in a ticket are added by the bot under your message, so you can't change them there, only their labels: the panel button's is in the panel settings and the Close ticket button's is under Labels and text. Variables, besides the ones every message has:

- First message in a ticket: `{user}`, `{username}`, `{subject}`, `{title}` (the subject, or "New ticket" when there is none), `{number}`, `{ticket}` and `{supportRoles}`. The mentions in it do ping, so keep `{supportRoles}` if the team should be notified.
- Closing: `{closedBy}`, `{reason}`, `{number}` and `{ending}`, which is a colon and the reason when `/ticket close` was given one and a full stop otherwise. The default is "Closing this ticket{ending}".
- Transcript post: `{number}`, `{user}`, `{subject}`, `{closedBy}` and `{ticketName}`. The transcript is still attached as a text file.
- Reply when a ticket is opened: `{ticket}`, `{number}` and `{subject}`. Only the member sees it.
- `/ticket add` and `/ticket remove`: `{member}`, `{staff}` and `{number}`.
- `/ticket panel`: `{panelChannel}`. Only the person who ran it sees it.

A panel saved with a title and body keeps them as an embed in the same colour.

The refusals and failures are messages too, under **Replies and errors**, in three groups, and only the person they are for sees them. **Who may do what** covers someone who isn't allowed to post the panel, close a ticket, add a member or remove one, using a ticket command outside a ticket, closing a ticket that is already closed, and a ticket whose channel has gone. **Opening a ticket** covers a deleted or full category, a member at their limit (`{openCount}` and `{limit}`; there is one wording for a limit of one ticket and one for a higher limit), a missing category when the form is sent in, and Discord refusing to create the channel. **Posting the panel** covers a missing panel channel and a channel the bot can't post in.

**Labels and text** holds the short strings that go to Discord rather than being sent as a message: the title and question on the form members fill in, the Close ticket button, the name of the ticket channel (`ticket-{username}` to start with, tidied to lowercase letters, digits, hyphens and underscores after it is filled in), the channel topic with and without a subject (`{tag}`, `{username}` and `{subject}`), the reason Discord's audit log records when a ticket closes (`{tag}`), the name used for an automatic close ("Auto-close"), and the file name of the transcript (`ticket-{number}.txt`). The transcript text has its own sub-group: the first line, who opened it, the subject line, who closed it, the line for a ticket nobody wrote in, the heading above each message, the line for each attachment, and the stand-ins for a message with no text and an author the bot doesn't know. Each is filled in from the ticket and starts as the wording the transcript has always had.

An automatic close doesn't post anything in the ticket by default. Switch on **Post the closing message first** under **Inactivity** and the closing message is posted just before the channel is deleted, with the reason set to what you put in **Reason given for an automatic close** ("No activity in this ticket"). The channel is deleted straight away, so the message is mainly there to appear in the transcript.

![Ticket panel settings with a preview](images/tickets-settings.png)

## Log channel

Found under **More** in the sidebar, since most servers use [Server logs](#server-logs) instead. Posts what changed on the server into a channel you pick, so staff who stay in Discord see it as it happens. It doesn't keep anything searchable. It posts: message edits and deletions, joins and departures, nickname and role changes, channels and roles created and deleted, bans and unbans. Every category has its own switch. Entries for messages the bot never cached say what's known and leave out the rest. An edit that didn't change the text, like a link preview loading, is skipped. The log channel isn't logged about itself, and bot messages are skipped unless you ask for them.

Every kind of entry has its own message under **How each entry looks**, edited with the same message builder as everywhere else, and it starts out as the entry the bot posts today. Each one has variables for what happened, such as `{author}`, `{content}`, `{before}` and `{after}` for messages, `{member}` for joins, departures and bans, `{reason}` for a ban, `{new.channel}` and `{old.channel}` for channels, and `{new.role}` and `{old.role}` for roles. The editor lists them for each entry. A line whose variable is empty is left out, which is how a ban with no reason has no reason line, and how a nickname change doesn't show the role lines. Nickname and role changes share one entry. Put the variables in the embed rather than the message text: text from a deleted or edited message can contain mentions, and an embed never pings anyone. Which events are posted is still chosen with the switches, not by the messages.

When the bot doesn't know something, it writes a stand-in into the variable. Under **Labels and text** you can reword all five: the author of a message the bot never saw ("Unknown (not cached)"), a deleted message it couldn't read ("Unavailable (message was not cached)"), the text before an edit it never saw ("Unavailable (not cached)"), the text after an edit that has none ("Unavailable"), and a member with no nickname ("(none)").

## News and patch notes

Posts what's new from sources you can't follow with Discord's Follow button.

![News feeds and Steam patch note channels with their status](images/news-feeds.png)

**News feeds** take any RSS or Atom address: a site, a subreddit with `.rss` added, a YouTube channel's feed. Each has its own channel, an optional name above the post, and an optional role to ping.

**Patch notes** come from Steam, per game, by the number in the game's store address. The developer's own announcements are used, not news site reposts. Games are listed under each channel, so one channel can carry your shooters and another your RPGs, and a game can appear under several. Each post is an embed with the game's logo, name and title, with an optional ping per channel. A post counts as patch notes when Steam tags it that way or its title says so ("Patch 2.31", "Hotfix 1.2"), and announcements about an update that hasn't shipped are skipped. Per game, you choose patch notes only or every announcement.

A new source posts its newest item once, to show it works, then only new items. If a source suddenly returns a lot, such as a feed that was down for a week, at most five are posted. Sources are checked every 15 minutes by default and never more often than every 5.

- `/feeds status` shows what's watched, when each source was last checked, and why one isn't working.
- `/feeds send` posts the latest items from one feed or game now (up to ten, oldest first). Give it part of a name or address, and if that matches several sources it lists them. The scheduled checks won't repeat what it sent. Only members who can manage the server see `/feeds` by default.

The post for news items and the post for patch notes are each a message you can rewrite, under **Post** in their sections, and they start out as the embed described above. News items have `{source}`, `{title}`, `{link}`, `{description}`, `{image}`, `{published}` and `{role}`. Patch notes have `{game}`, `{game.id}`, `{title}`, `{link}`, `{description}`, `{logo}`, `{published}` and `{role}`. `{description}` is already cut to the length the bot uses (400 characters for news, 900 for patch notes), and a variable that is empty, such as the picture of an item that has none, is simply left out. The role you pick to ping is not added by itself: it arrives as `{role}`, which the starting message has as its text, so keep `{role}` in the text if you still want the ping. `{published.iso}` is the same moment in the form an embed's time setting needs. Rewriting the post applies to every feed or game, not to one of them. The answer to `/feeds send` can be reworded from the Commands page with `{posted}`, `{count}`, `{source}` and `{problem}`.

The rest of what the commands say is under **Replies and errors**, four short messages that only the person who ran the command sees: nothing is being watched, what `/feeds status` shows (`{lines}` is one line per source and `{count}` how many), nothing matches what was typed after `/feeds send` (`{query}`), and more than one source matches (`{query}` and `{sources}`). The list is cut to 1900 characters, as it always was, so the text you put around it still fits in Discord's 2000.

**Labels and text** holds the words those replies are built from. Each source's line in `/feeds status` has three forms: not checked yet (`{source}`), working (`{source}` and `{checked}`), and a problem (`{source}`, `{checked}` and `{problem}`). **Sentence for a send that stopped early** fills `{problem}` in the reply to `/feeds send` and understands `{error}`. **Problem descriptions** are the sixteen short reasons a source can fail, such as the site being too slow, an address that isn't a feed, or a deleted channel, with `{status}` in the two that quote a status code. They are written down when a source is checked, so a reworded one shows up beside the source after its next check.

The messages beside each source on the dashboard, such as "Send latest posts", are not in the bot's Discord replies and keep their fixed wording.

Feed addresses are fetched from the public internet only. An address pointing at the bot's own machine or network is refused, which matters when people other than the operator can reach the dashboard.

## Leveling

XP for taking part, levels, and roles at thresholds you choose. Each message is worth a random amount inside a range you set, so nobody can count to the next level, and a cooldown means a burst of one-word messages isn't worth more than a conversation. Role rewards either stack or replace. A role can carry an XP multiplier, and when a member has several, only the biggest applies. Rank and the leaderboard are plain embeds. There's no generated image card, since drawing one adds a native dependency that makes every install harder.

The replies to `/rank` and `/leaderboard` are edited from the Commands page, and the level-up announcement is a message under **Level-up announcements**. Under **Replies and errors**, two more messages cover `/leaderboard` when there is nothing to show: one for a server where nobody has earned experience yet, and one for a page past the last (`{page}` is the page that was asked for). Under **Labels and text**, **Rank for a member with no experience** is what `{rank}` says in `/rank` for someone who hasn't earned any ("Unranked" to start with), and **Line for each member on the leaderboard** is how every row of `{leaderboard}` is written. It understands `{position}`, `{name}`, `{level}` and `{xp}`.

![Leveling settings](images/leveling-settings.png)

## Updates, changelog and what's coming

The **Updates** link in the sidebar opens a page with the version you are running, whether a newer release is out, the steps to update, and the changelog of every release with its notes. When a new version is out, the sidebar link gets a dot.

**Coming soon**, just above Help, opens the roadmap in a window from any page: what is planned. It is the same list as on the Updates page.

The dashboard does not apply updates itself, because that would give it the power to replace itself and run commands on your machine. The page shows the two commands to run instead. It reads releases and the roadmap from GitHub and sends nothing about your install. The owner can switch checking off on the Updates page, and then nothing is requested, and the roadmap shown is the one that came with your version.

## Utility

Server and member info commands. It's small, and it mostly shows the module runtime works end to end.

`/ping`, `/serverinfo` and `/userinfo` are reworded from the Commands page like any other reply. Until you write one, they answer as they always have: **Embed color** sets the colour of the standard `/serverinfo` and `/userinfo` replies, and **Show join dates on /userinfo** adds or removes the "Joined server" line in the standard `/userinfo` reply. A reply you wrote sets its own colour and decides for itself which lines it has, so those two settings no longer apply to it. Under **Labels and text**, **When a join date is not known** is what `{joined}` says in a `/userinfo` reply you wrote, for someone who isn't in the server. It starts as "Unknown". The standard reply leaves the line out for that person instead.
