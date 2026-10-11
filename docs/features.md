# Features

Every feature is a module. You switch modules on per server from the dashboard and the change applies immediately. A module that's off does nothing.

Most settings are optional. Leave one blank and that part of the module stays quiet. The dashboard explains each field as you fill it in, so this page covers behavior you wouldn't guess from the settings screen.

- [Quick setup](#quick-setup)
- [Moderation](#moderation)
- [Moderation dashboard](#moderation-dashboard)
- [Automod](#automod)
- [Welcome messages](#welcome-messages)
- [Role menus](#role-menus)
- [Tickets](#tickets)
- [Audit logging](#audit-logging)
- [News and patch notes](#news-and-patch-notes)
- [Leveling](#leveling)
- [Utility](#utility)

## Quick setup

A feature's settings page shows everything it has, which is a lot for a first visit. Quick setup asks only for the few settings a feature can't work without, one feature per screen, and switches the feature on at the end.

You'll find it under Quick setup in the sidebar, and there's a link from each feature's own page. **Moderation** and **Tickets** walk through several related features together. Below them, every feature that has a quick setup is listed on its own.

It never locks anything in. Settings it doesn't ask about keep their values, skipping a step leaves that feature as it was, and anything it sets can be changed later on the full page. Run it as often as you like.

Features whose settings are all repeating rows, like role menus, have no quick setup, because there's no short version of "how many menus do you want".

## Moderation

Warnings, timeouts, kicks, bans and temporary bans. Each one gets a numbered case you can look up later.

- **Role hierarchy is checked on every action.** A moderator can't act on someone whose highest role is at or above their own, the bot can't act on anyone above it, and nobody can act on the server owner. The check runs before the request goes to Discord, so you get a refusal that explains itself and not a bare permissions error.
- **A temporary ban schedules its own unban.** The pending unban is stored in the database, so restarting the bot doesn't leave someone banned forever. If you unban by hand first, the pending one is dropped.
- **Discord's limits apply.** A timeout can't be longer than 28 days, and bulk message deletion can't touch anything older than 14 days. The commands say so up front.
- **Cases outlive the action.** Unbanning marks the ban inactive and keeps the row, so the history stays readable.

A case that staff removed from a member's record in the [moderation dashboard](#moderation-dashboard) is hidden from `/history` and `/case`. `/history` skips it, and `/case` answers as if that number didn't exist. The row is still in the database and still shows in the dashboard, marked as removed.

## Moderation dashboard

Each server has a Moderation area in the sidebar. Staff use it to read a member's record, leave notes, take back a mistaken action and see how moderation is going. It shows the cases the moderation and automod features record, so there's nothing extra to switch on.

It has up to six tabs:

| Tab | What it's for | Who sees it |
| --- | --- | --- |
| Overview | Statistics | Staff |
| Members | Everyone with something on file | Staff |
| Actions | The log of every case | Staff |
| Audit | What staff have changed | Admins and the owner |
| Access | Who can use all of this | The owner |
| Settings | Moderation and Automod settings | Anyone with Manage Server |

A search box in the header finds a member from any tab. Press Ctrl+K (Cmd+K on a Mac), press `/` when you're not typing in a field, or click it. It searches members who have a record and the server's member list, by name or user ID.

### Who can open it

Access to Moderation is separate from the right to change a server's settings.

- **The owner of the install** is the first account that signed in, or the user ID in `INSTANCE_OWNER_ID`. The owner can use Moderation in every server the bot is in and isn't listed on the Access tab.
- **Everyone else** can use it only in servers where the owner has added them, as a Moderator or an Admin. The owner adds someone on the Access tab by searching for their name or pasting their Discord user ID, and can do it before that person has ever opened the dashboard.
- **Manage Server** in Discord doesn't make someone staff. It opens one tab, Settings, and nothing else under Moderation. Being listed staff doesn't give access to a server's settings either. Staff without Manage Server see Moderation and Help in the sidebar and no Settings tab.

| Permission | Moderator | Admin | Owner |
| --- | --- | --- | --- |
| Open Moderation and read member records | Yes | Yes | Yes |
| See the statistics | Yes | Yes | Yes |
| Write notes on a member | Yes | Yes | Yes |
| Warn a member | Yes | Yes | Yes |
| Time a member out, or end a timeout early | Yes | Yes | Yes |
| Kick, ban or unban a member | No | Yes | Yes |
| Take a warn or timeout off a record | Yes | Yes | Yes |
| Read the audit trail | No | Yes | Yes |
| Export the action log as CSV | No | Yes | Yes |
| Edit or delete notes written by other staff | No | Yes | Yes |
| Read and restore deleted notes | No | Yes | Yes |
| Put a removed action back on a record | No | Yes | Yes |
| Take a kick, ban or any other action off a record | No | No | Yes |
| Purge an action or note permanently | No | No | Yes |
| Choose who has access, and at what level | No | No | Yes |

Anyone can edit or delete a note they wrote. The warns and timeouts a moderator can take off a record include the ones automod recorded, and automod's message deletions.

### Member records

The Members tab lists every member with at least one action or note on file, not counting removed ones. You can filter to members who are restricted right now, who have notes, or who were acted on in the last seven days, and sort by most recent action, number of actions, number of notes or name.

A member's page shows their roles, when they joined, when their account was created, and a timeline of everything on their record: actions, notes and, for admins and the owner, staff activity that concerns them. Each entry is labeled with what it is, and the buttons above the timeline narrow it to one kind.

**Notes are for staff only.** Every staff member can read every note on a member. The member never sees them and the bot never sends them to Discord. A note is up to 2,000 characters, a member can carry 200 notes, and one person can add 30 a minute.

**Nothing disappears from the timeline when it's removed.** A removed action or a deleted note stays where it was, marked with who removed it and when. A removed action also shows the reason given. A deleted note's text is shown to admins and the owner. A moderator sees that it was deleted and by whom, but not what it said.

### Taking action

A **Take action** button on a member's page lists what your level allows: warn, timeout, clear a timeout, kick, ban and unban. Moderators can warn and time out, which includes clearing a timeout. Admins can also kick, ban and unban. The owner can do everything. The menu only shows what fits the member. Unban appears for someone who is banned and Ban for someone who isn't, Clear timeout only while a timeout is running, and a timeout on someone already timed out reads Change timeout.

Each choice opens a short form:

- Every action takes a reason of up to 500 characters. It's required when the Moderation setting "Require a reason for moderation actions" is on.
- A timeout asks how long, from one second to 28 days, starting from the server's default timeout length.
- A ban is permanent unless you give it a length, up to 3,650 days. It also asks how many days of the member's messages to delete, from 0 to 7, starting from the server's setting.
- The confirm button names the action and the person.

**It's the same action as the slash command.** The dashboard and commands like `/ban` run the same code, so the result is identical. The role hierarchy is checked first. The member gets a direct message if the Moderation setting "Direct message the member when action is taken" is on. Then the bot makes the change in Discord, writes the case, schedules the unban for a temporary ban and posts to the mod log channel. The case names you as the moderator. When it's done, the page shows the case number and anything worth knowing, such as a direct message that couldn't be delivered or a mod log channel that no longer exists.

**Some things are always refused**, with a message that says why:

- The Moderation feature has to be switched on. It supplies the mod log channel, the direct message and the defaults.
- An action whose command is switched off on the Commands page is unavailable here too. Clearing a timeout follows the timeout command.
- You can't act on the server owner, on anyone whose highest role is equal to or above yours, or, for anything that changes Discord, on anyone whose highest role isn't below the bot's. A warning only writes a record, so the bot's position doesn't stop one.
- You can't act on yourself or on the bot.
- You have to be a member of the server, because the bot compares your roles with theirs. The owner of the install is the exception and is treated as the server owner would be, but can't get past the bot's own position or the server owner.
- Only one action on a member can run at a time, and each staff member can take 20 actions a minute in a server.
- A ban longer than 3,650 days is refused, here and with `/ban`. Leave the length out for a permanent ban.

**Someone who has left can still be warned, banned and unbanned.** A warning on a member who's no longer in the server is a record only, and the page says so. Banning them stops them joining again. Kicks, timeouts and clearing a timeout need the member to be in the server. The dashboard never sends a direct message to someone who isn't in the server, except on an unban, because otherwise a staff member's text could be sent to any Discord account.

### The right-click menu in Discord

With Moderation switched on, staff can also act without opening the dashboard. Right-click (or long-press) a member or a message, choose **Apps**, and pick an entry.

- On a member: Warn member, Timeout member, Kick member, Ban member and Member history.
- On a message: Warn author, Timeout author, Kick author and Ban author.

An action opens the same short form as the dashboard, with a reason and, for a timeout or ban, a length. Acting from a message adds a link to it in the reason, so the case shows what prompted it.

Who sees an entry and who can use it are separate. Discord shows an entry to members with the matching permission: Timeout Members for warn, timeout and history, Kick Members for kick, and Ban Members for ban. Members without it don't see the entry. Seeing it isn't enough to use it, though. The person also has to be on the staff list for that server, or be the install's owner, and the same levels apply as in the dashboard. Anyone else who runs an entry is told they're not on the staff list, and nothing happens.

If a moderator on your staff list can't see the entries, give their role the Timeout Members permission. Server owners can also change who sees each entry under Server Settings, Integrations.

Each entry is a command of its own on the Commands page. It's marked as a right-click entry and can be switched off or limited to roles and channels like any other.

### Removing, restoring and purging

There are three levels, each stronger than the last.

**Remove from record** is the everyday one. The entry stays on the timeline, struck through, with your name, the time and the reason you gave. A reason is required, up to 500 characters. A removed action stops counting in the member's totals, in the statistics, and in `/history` and `/case`. Moderators and admins can remove warns and timeouts. Only the owner can remove a kick, a ban or an unban.

Removing a timeout that's still running also lifts it in Discord, if the bot is allowed to. It won't, and says so in the audit entry, if the member has left, if the bot ranks below them, or if another timeout against the same member is still in force. This covers timeouts from the timeout command and ones issued by automod.

**Restore** puts a removed action or a deleted note back. Admins and the owner can do it. A restore never contacts Discord, so a restored timeout isn't applied again and a restored ban doesn't ban the member a second time.

**Purge forever** is for the rare entry that shouldn't exist at all. Only the owner can do it, and it asks you to type `purge` first. It deletes the action or note and every audit entry about it, and writes nothing in their place. The audit trail won't show that it existed, and it can't be undone. The `/purge` command that bulk deletes messages is unrelated.

Case numbers are assigned when a case is created and are never renumbered or reused. Each server has a counter that only goes up. Purging case 12 leaves a permanent gap: 11 and 13 keep their numbers and no later case gets 12, even if 12 was the newest. Cases that were only removed keep their numbers too.

A purge removes the row from the database, but SQLite can leave the deleted bytes in unused space inside `tier0.db` until they're overwritten or the file is compacted, and earlier backup copies still contain the entry. Treat a purge as removing something from the dashboard, not as secure erasure.

### The audit trail

Admins and the owner can open the Audit tab. It lists every change made through the dashboard: a note added, edited, deleted or restored, an action removed or restored, and a staff member added, given a different level or removed. The owner's changes are recorded like anyone else's. Purges are the one thing left out, on purpose.

Each entry shows when it happened, who did it, the level they were acting at, and what it concerned. For edits, removals and restores you can expand an entry to see the record before and after. You can filter by type of change, staff member, member ID, a range of dates in UTC, and words in the description. The same entries show on a member's timeline as Staff activity.

The audit trail covers dashboard changes. Cases created by commands and by automod are the actions themselves and appear in the Actions tab.

### Statistics

The Overview tab covers 7, 30 or 90 days, chosen at the top. Days are UTC days and the range ends with today, even though today isn't over. A 7 day range is today and the six days before it.

The tiles count what happened in that range:

- **Actions** is every case recorded in the range that hasn't been removed, including unbans and ones automod recorded.
- **Warns**, **Timeouts** and **Kicks and bans** count only actions taken with the moderation commands or from the dashboard. Automod's actions, unbans and other minor kinds count toward Actions and show as Other in the daily chart, but not in these three.
- **Removed** is the number of cases created in the range that have since been removed. It follows the date of the action, not the removal.
- **Notes** is the number of notes written in the range, including ones deleted since.

Each tile compares itself with the previous period, which is the same stretch of time moved back by the length of the range. For a 30 day range, that's the 30 days that ended 30 days ago, up to the same time of day, so a half-finished today is compared with an equally half-finished day. The comparison only shows when something on file is older than the start of the range, because otherwise there's nothing to compare against. A fall in Actions, Warns, Timeouts or Kicks and bans is shown as an improvement. Removed and Notes have no good or bad direction, so they're shown without one. The percentage reads "New" when the previous period had none.

Below the tiles:

- **Right now** isn't limited to the range. *In force* counts timeouts and bans still active, and *On record* counts members with at least one entry that hasn't been removed, over all time.
- **Repeat actions** is the share of members actioned in the range who were actioned again within 30 days of an earlier action, which can be from before the range. Automod's entries, unbans and cleared timeouts are left out, since they don't show how often staff had to act on a person. It appears once at least five members were actioned in the range.
- **Automod** counts the warns, timeouts and message deletions that automod rules made in the range, with the change from the previous period and the rules that fired most. It names the rule from the start of each entry's reason, shows the ten busiest and groups the rest as "other", and links to the action log filtered to automod. If automod did nothing it says so, which doesn't mean automod is off.
- **Busiest hours** is a strip of the 24 hours of the day in UTC, shaded by how many actions fell in each.
- **Moderators** lists who took the actions, busiest first, with the mix of warns, timeouts, kicks and bans, the notes they wrote, how many of their actions were later removed, and when they last acted. Selecting a name opens the Actions tab filtered to that person.
- **Most actioned members** is the ten members with the most actions in the range.

### The action log

The Actions tab lists every case, newest first. You can narrow it by type (warn, timeout, kick, ban or unban), state, source, moderator, or by searching the reason, a case number or a member ID. It doesn't search by name. The source is **Manual** for entries from staff, by command or from the dashboard, or **Automod** for ones automod recorded. The default is both.

An entry's state is one of four. *In force* is a timeout or ban that hasn't run out or been lifted. *Expired* is a timeout whose end time has passed. *Removed* is an entry staff took off the record. Everything else, such as a warn or a kick, is *On record*.

Admins and the owner see an export button. It downloads a CSV of the entries matching your current filters, newest first, up to 5,000. If more match, you get the newest 5,000, and you can narrow the filters and export again for the rest. Removed entries are included. The file is named `tier0-actions-<server id>-<date>.csv`:

| Column | Contents |
| --- | --- |
| `case number` | The case number |
| `created at` | When the action was taken, in UTC |
| `member id`, `member name` | The member the action was taken against |
| `action` | The action, such as `warn` or `timeout` |
| `reason` | The reason given, if any |
| `moderator id`, `moderator name` | Who took the action |
| `state` | `active`, `expired` or `removed`. A warn or kick stays `active` while it's on the record |
| `expires at` | When a timeout or temporary ban ends, if it does |
| `removed at`, `removed by`, `removal reason` | Filled in only for removed entries |

Names are looked up from Discord when the file is made. A name that can't be found quickly is left blank, which can happen to the oldest cases in a large export. The ID columns are always filled in.

Reasons and member names are typed by other people, so any cell that begins with `=`, `+`, `-` or `@`, or with a tab or carriage return, gets an apostrophe in front of it. That stops a spreadsheet treating it as a formula. The apostrophe is part of the stored text, so strip it if you load the file into anything other than a spreadsheet.

### Access tab

The owner uses this tab to add staff to a server, switch someone between Moderator and Admin, and remove them. Bots can't be added. Removing a person takes away their access and nothing else: the notes and actions they recorded stay on file. Every change goes in the audit trail. A table on the tab lists what each level can do, read from the same rules the bot enforces.

### Settings tab

The settings for Moderation and Automod are on the Moderation area's Settings tab, since they belong with the records and statistics next to them. A switch at the top of the tab moves between the two. They're the usual settings forms with the usual Save changes bar, and they're no longer listed under their own heading in the sidebar. The old addresses for those two pages still work and redirect here. Quick setup is unchanged.

Opening this tab takes Manage Server on the server, like every other feature's settings. A staff role never grants it, and Manage Server on its own shows this tab and no other under Moderation.

### The sidebar

The sidebar can shrink to a narrow strip of icons. Use the button in its header, or press Ctrl+B (Cmd+B on a Mac). Hover over or tab to an icon to see its name. The browser remembers your choice per browser, not per account. On a phone the sidebar stays a drawer that opens from the top bar.

## Automod

Seven rules you switch on separately, each with its own action and exemptions: invites, links, capital letters, repeated text, mention limits, banned words and rate limiting.

Every rule starts off. Switching the module on does nothing until you pick rules.

**Banned words matching is conservative on purpose.** Text is lowercased, common letter-for-number swaps are folded back, a letter stretched out three or more times is collapsed, and then it matches on word boundaries. So `assassin` won't trigger a rule for the rude three letters inside it.

The cost is that spacing letters out gets past it. Catching that means stripping whitespace, which glues unrelated words together and brings the false positives back. Missing a few real cases is better than deleting innocent messages.

Anyone with moderator permissions is exempt by default, and you can turn that off. When several rules trip on one message, you get one action, the most severe.

## Welcome messages

Greetings when someone joins, farewells when they leave, an optional direct message, and roles given on arrival.

Messages support `{user}`, `{username}`, `{server}` and `{memberCount}`. If you use a placeholder the module doesn't know, saving fails and names it, so a typo shows up right away and not in a greeting three weeks later.

The bot can't give a role positioned above its own. It checks first, logs it, and carries on with the rest of the join.

## Role menus

Members pick their own roles from a menu you publish to a channel.

The menus use buttons and not reactions. Buttons keep working after the message falls out of the bot's cache, they don't need the message content permission, and the member gets a private confirmation with no reaction left on the message. Publishing a menu a second time edits the message that's already there.

Mark a menu exclusive and picking one option clears the others. That suits pronouns or colors, where only one answer makes sense.

## Tickets

A panel with a button. A member presses it, gives a subject, and gets a private channel with your support team.

The channel denies visibility to the whole server, then grants it back to the opener, your support roles and the bot. Nobody else sees it, whatever other roles they have.

Transcripts are optional and go to a channel you pick when the ticket closes. Auto-close is optional too, and its clock resets whenever somebody speaks. A member who's hit their ticket limit is told so.

## Audit logging

A record of what changed on the server, written to a channel you pick: message edits and deletions, joins and departures, nickname and role changes, channels and roles created and deleted, bans and unbans. Every category has its own switch.

Discord sends very little about a deleted or edited message the bot never cached. Those entries say what's known and leave out the rest. An edit that didn't change the text, which is what you see when a link preview loads, is skipped.

The log channel is never logged about itself, and bot messages are skipped unless you ask for them.

## News and patch notes

The bot reads sources for you and posts what's new, for sources you can't follow with Discord's own Follow button.

**News feeds** take any RSS or Atom address: a site, a subreddit with `.rss` added to its address, a YouTube channel's feed. Each feed has its own channel, an optional name shown above the post, and an optional role to ping.

**Patch notes** are read from Steam, per game, by the number in the game's store address. The developer's own announcements are used, and reposts from news sites aren't. You list games under each channel, so one channel can carry your shooters and another your RPGs, and a game can appear under more than one. Each patch note is an embed with the game's logo, its name and the post's title, with an optional role to ping per channel.

Developers don't label patch notes consistently, so a post counts when Steam tags it as patch notes or its title says so, such as "Patch 2.31" or "Hotfix 1.2". An announcement that only mentions an update that hasn't shipped is left out. What to post is set per game: patch notes only, or every announcement the developer makes. A studio that posts mostly patch notes suits the first, and one whose announcements are all worth seeing suits the second.

A source's newest item is posted when you first add it, to show it works, and only new items after that. If a source suddenly returns a lot, such as a feed that was down for a week, at most five are posted and the rest are skipped. Sources are checked every 15 minutes by default and never more often than every 5.

`/feeds status` shows what's being watched, when each source was last checked, and the reason when one isn't working.

`/feeds send` posts the latest items from one feed or game right away, to the channel it's set up for. Give it part of the feed's name or address, or the game's name, and a count of up to ten. It posts them whether or not they were posted before, oldest first, and the scheduled checks won't repeat them. If what you typed matches more than one source, it lists the matches instead of guessing. Only members who can manage the server see `/feeds` by default.

Feed addresses are only fetched from the public internet. An address that points at the machine the bot runs on, or anything else on its network, is refused. That matters when people other than the operator can reach the dashboard.

## Leveling

Experience for taking part, levels earned from it, and roles at thresholds you choose.

Each message is worth a random amount inside a range you set, so nobody can count their way to the next level. A cooldown between awards means a burst of one-word messages isn't worth more than a conversation.

Role rewards either stack, keeping everything earned so far, or replace, keeping only the highest. You can attach a multiplier to a role. When a member has several, only the biggest applies, so an unplanned combination of roles can't spiral.

Rank and the leaderboard are plain Discord embeds. There's no generated image card. Drawing one pulls in a native dependency that makes every install harder, for what amounts to decoration.

## Utility

Server and member info commands. It's small on purpose and mostly exists to show that the module runtime works end to end.
