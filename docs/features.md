# Features

Every feature is a module. You switch modules on per server from the dashboard
and the change takes effect straight away. A module you have not switched on
does nothing at all.

Most settings are optional. Leave one blank and that part of the module stays
quiet.

This page covers the things you would not guess from the settings screen. The
dashboard explains each individual field as you fill it in.

## Quick setup

A feature's settings page shows everything it has, which is more than you need
in front of you the first time. Quick setup asks only the few settings a feature
cannot work without, one feature per screen, and switches it on at the end of
each.

Two ways in, both under Quick setup in the sidebar. **Moderation** and
**Tickets** each walk several features that are worth deciding together;
underneath them, every feature that offers a quick setup is listed on its own.
There is a link to it from each feature's own page too.

Nothing it does is one-way. Settings it does not ask about keep the values they
already have, skipping a step leaves that feature exactly as it was, and
anything it does set can be changed afterwards on the full page. Run it as often
as you like.

Which settings it asks about is the module's own decision, declared in its
schema. A module whose settings are all repeating rows (role menus, say)
offers no quick setup, because there is no sensible short version of "how many
menus do you want".

## Moderation

Warnings, timeouts, kicks, bans and temporary bans. Each one gets a numbered
case you can look up later.

**Hierarchy is enforced on every action.** A moderator cannot action anyone
whose highest role sits at or above their own, and the bot cannot action
anyone above itself. Nobody can action the server owner. The check happens
before the request reaches Discord, so you get a refusal that explains itself
and not a bare permissions error.

**A temporary ban schedules its own reversal.** The pending unban is a row in
the database, so restarting the bot does not leave someone banned forever. If
you unban by hand first, the pending one is dropped.

Timeouts use Discord's own timeout feature, and Discord caps that at 28 days.
Ask for longer and the command tells you why it will not. Bulk deletion cannot
touch anything older than 14 days, again Discord's limit, and the command says
so up front so you are not left wondering which messages went.

Cases outlive the action. Unbanning marks the ban inactive and keeps the row,
so the history still reads properly.

A case that staff have removed from a member's record in the
[moderation dashboard](#moderation-dashboard) is hidden from `/history` and
`/case`. `/history` skips it and `/case` answers as if the number did not exist.
The row is still in the database and still shows in the dashboard, marked as
removed.

## Moderation dashboard

Each server has a Moderation area in the dashboard, under Moderation in the
sidebar. It is where your staff read a member's record, leave notes, take back a
mistaken action and see how moderation is going. It shows the cases the
moderation and automod features record, so there is nothing separate to switch
on.

It has up to six tabs. **Overview** has the statistics. **Members** lists
everyone with something on file. **Actions** is the log of every case.
**Audit** shows what staff have changed and is for admins and the owner.
**Access** chooses who can use all of this and is for the owner only.
**Settings** holds the Moderation and Automod settings and is for people with
Manage Server; see [Settings](#settings-tab). For staff, a search box in the
header finds a member from any tab: press Ctrl+K (Cmd+K on a Mac),
press `/` when you are not typing in a field, or use the button. It searches
members who have a record and the server's member list, by name or user ID.

### Who can open it

Access to Moderation is separate from the right to change a server's settings,
and neither implies the other.

- The owner of the install, which is the first account that signed in (or the
  user ID in `INSTANCE_OWNER_ID`), can use Moderation in every server the bot
  is in. The owner is never listed on the Access tab.
- Everyone else can use it only in the servers where the owner has added them,
  at one of two levels: Moderator or Admin. The owner adds someone on the Access
  tab by searching for their name or pasting their Discord user ID. You can add
  a person before they have ever opened the dashboard.
- Anyone can sign in with Discord, but a person with no entry has nothing to
  open.
- Having Manage Server in Discord does not make someone staff. It opens one
  tab, Settings, and nothing else under Moderation. Being listed staff does not
  give access to a server's settings either: someone who is staff but cannot
  manage the server sees only Moderation and Help in the sidebar, and no
  Settings tab.

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

Anyone can edit or delete a note they wrote themselves. The warns and timeouts a
moderator can take off a record include the ones automod recorded, along with
automod's message deletions.

### Member records

The Members tab lists every member who has at least one action or note on file,
not counting removed ones. Filter it to members who are restricted right now,
who have notes, or who were acted on in the last seven days, and sort it by most
recent action, number of actions, number of notes or name.

Opening a member shows their roles, when they joined and when their account was
created, and a timeline of everything on their record: actions, notes and, for
admins and the owner, the staff activity that concerns them along with a few
quick facts about who has handled the record. Buttons above the timeline narrow
it to one of those.

**Notes are for staff only.** Every staff member can read every note on a
member. The member never sees them and the bot never sends them to Discord. A
note can be up to 2,000 characters, a member can carry 200 notes at a time, and
one person can add 30 a minute.

**Nothing disappears from the timeline when it is removed.** A removed action
and a deleted note stay where they were, marked with who removed them and when.
A removed action also shows the reason given. A deleted note shows its text to
admins and the owner. A moderator sees that the note was deleted and by whom,
but not what it said, because only people who can restore a note may read it
again.

### Taking action

You do not have to switch to Discord to act on someone. A **Take action**
button on a member's profile lists what your level allows: warn, timeout, clear a
timeout, kick, ban and unban. Moderators can warn and time out, which includes
clearing a timeout. Admins can also kick, ban and unban. The owner can do all of
it. The menu only lists what fits the member: Unban appears for someone who is
banned and Ban for someone who is not, Clear timeout only while a timeout is
running, and a timeout on someone already timed out reads Change timeout.

Each choice opens a short form. Every action takes a reason of up to 500
characters, and the reason becomes required when the Moderation setting
"Require a reason for moderation actions" is on. A timeout asks how long, from
one second to Discord's limit of 28 days, starting from your server's default
timeout length. A ban is permanent unless you give it a length, up to 3,650
days, and it asks how many days of the member's messages to delete, from 0 to 7,
starting from your server's setting. The confirm button names the action and the
person, so a ban is never one click on an unlabelled button.

**It is the same action as the slash command.** The dashboard and commands such
as `/ban` run the same code, so the result is identical either way. The role
hierarchy is checked first. The member is sent a direct message if the Moderation
setting "Direct message the member when action is taken" is on. Then the bot makes
the change in Discord, writes a case with its stored number, schedules the unban
for a temporary ban, and posts to the mod log channel. The case names you as the
moderator. When it is done the profile says which case it created, along with
anything you would want to know, such as a direct message that could not be
delivered or a mod log channel that no longer exists.

**Some things are always refused**, with a message saying why:

- The Moderation feature has to be switched on. It supplies the mod log
  channel, the direct message and the defaults, so the dashboard will not act
  without it.
- An action whose command is switched off on the Commands page is unavailable
  here too, and is left out of the menu. Clearing a timeout follows the timeout
  command.
- Nobody can act on the server owner, on anyone whose highest role is equal to
  or above yours, or, for anything that changes Discord, on anyone whose highest
  role is not below the bot's. A warning only writes a record, so the bot's
  position does not stop one.
- You cannot act on yourself or on the bot.
- You have to be a member of the server, because the bot compares your roles
  with theirs. The owner of the install is the exception and is treated as the
  server owner would be, but still cannot get past the bot's own position or the
  server owner.
- Only one action on a member can run at a time, and each staff member can take
  20 actions a minute in a server.
- A ban of more than 3,650 days is refused, here and with `/ban`. Leave the length
  out for a permanent ban.

**Someone who has left can still be warned, banned and unbanned.** A warning on
a member who is no longer in the server is a record only, and the profile says
so. Banning them stops them joining again. Kicks, timeouts and clearing a timeout
need the member to be in the server. The dashboard never sends a direct message
to someone who is not in the server, because the message would carry text typed
by staff to an arbitrary Discord account. The one exception is an unban, since
the person is confirmed as banned from this server.

### The right-click menu in Discord

With Moderation switched on, staff can also act without opening the dashboard.
Right-click (or long-press) a member, or a message, choose **Apps**, and pick an
entry. On a member: Warn member, Timeout member, Kick member, Ban member and
Member history. On a message: Warn author, Timeout author, Kick author and Ban
author. An action opens the same short form as the dashboard, with a reason and,
for a timeout or a ban, a length. Acting from a message adds a link to that
message to the reason, so the case shows what prompted it.

**Who sees it and who can use it are two separate things.** Discord shows an entry
to members who hold the matching permission: Timeout Members for warn, timeout and
history, Kick Members for kick, Ban Members for ban. Members without it do not see
the entry at all. Showing it is not enough to use it. The person has to be on the
staff list for that server (or be the owner of the install), and the same levels
apply as in the dashboard: moderators can warn and time out, admins can also kick
and ban. Anyone else who somehow runs an entry is told they are not on the staff
list, and nothing happens. If a moderator on your staff list cannot see the
entries, give their role the Timeout Members permission. Server owners can also
change who sees each entry under Server Settings, Integrations.

Each entry is a command of its own on the Commands page, marked as a right-click
entry, and can be switched off or limited to roles and channels like any other.
The actions are the same code as the dashboard and the slash commands, so cases,
direct messages, the role hierarchy and the mod log behave identically.

### Removing, restoring and purging

There are three levels, each stronger than the last.

**Remove from record** is the everyday one. The entry stays on the timeline,
struck through, with your name, the time and the reason you gave. A reason is
required and can be up to 500 characters. A removed action stops counting in
the member's totals, in the statistics, and in `/history` and `/case`.
Moderators and admins can remove warns and timeouts. Only the owner can remove a
kick, a ban or an unban.

Removing a timeout that is still running also lifts it in Discord, as long as
the bot is allowed to. It will not, and says so in the audit entry, when the
member has left, when the bot ranks below them, or when another timeout against
the same member is still in force. This applies to timeouts given with the
timeout command and to the ones automod issued.

**Restore** puts a removed action or a deleted note back. Admins and the owner
can do it. A restore never contacts Discord, so a restored timeout is not
applied again and a restored ban does not ban the member a second time.

**Purge forever** is for the rare case where an entry should not exist at all.
Only the owner can do it, and it asks you to type the word `purge` first. It
deletes the action or note and every audit entry about it, and writes nothing in
their place. The audit trail will not show that it existed, and it cannot be
undone. The `/purge` command that bulk deletes messages is unrelated.

Case numbers are stored when a case is created and are never renumbered or
reused. Each server counts upward from its own counter, which only increases.
Purging case 12 leaves a permanent gap: 11 and 13 keep their numbers, and no
later case is ever given 12, even if 12 was the newest. Cases that were only
removed, not purged, keep their numbers too.

Purging removes the row from the database, but SQLite can leave the deleted
bytes in unused space inside `tier0.db` until they are overwritten or the file
is compacted. Backup copies of the file made earlier still contain the entry.
Treat a purge as removing something from the dashboard, not as a guarantee of
secure erasure.

### The audit trail

Admins and the owner can open the Audit tab. It lists every change made through
the dashboard: a note added, edited, deleted or restored; an action removed or
restored; and a staff member added, given a different level or removed. Changes
the owner makes are recorded like anyone else's. Purges are the one thing left
out, on purpose.

Each entry says when it happened, who did it and at which level they were acting
at the time, and what it concerned. For edits, removals and restores you can
expand the entry to see the record before and after the change. You can filter by
type of change, staff member, member ID, a range of dates in UTC, and words in
the description. The same entries appear on a member's own timeline under
Staff activity.

The audit trail covers dashboard changes. Cases created by commands and by
automod are the actions themselves, and are in the Actions tab.

### Statistics

The Overview tab covers 7, 30 or 90 days, chosen at the top. Days are UTC days,
and the range is whole days ending with today, so today is included even though
it is not over. A 7 day range is today and the six days before it.

The tiles at the top count what happened in that range:

- **Actions** is every case recorded in the range that has not been removed,
  including unbans and the ones automod recorded.
- **Warns**, **Timeouts** and **Kicks and bans** count only the matching
  actions taken with the moderation commands or from the dashboard. An action recorded by automod, an unban
  and the other minor kinds are counted in Actions and appear as Other in the
  daily chart, but not in these three.
- **Removed** is the number of cases created in the range that have since been
  removed. It follows the date of the action, not the date of the removal, and
  removed cases are not part of Actions.
- **Notes** is the number of notes written in the range, including any deleted
  since.

Each tile compares itself with the previous period: the same stretch of time
moved back by the length of the range. The range runs from midnight UTC at its
start to this moment, so the previous period runs from midnight UTC that many
days earlier to this same moment that many days ago. For a 30 day range, it is
the 30 days that ended 30 days ago, at the same time of day, so a part-finished
today is set against an equally part-finished day and not against a whole one.
The comparison appears only when something on file, an action or a note and
removed ones included, is older than the start of the range. Without that there is no
baseline, and it is left out. A fall in Actions, Warns, Timeouts or Kicks and
bans is shown as an improvement. Removed and Notes are shown without a verdict,
since neither says whether a server is doing well. The percentage is "New" when
the previous period had none.

Below the tiles:

- **Right now** is not limited to the range. *In force* counts timeouts and bans
  still active, and *On record* counts members with at least one entry that has
  not been removed, over all time.
- **Repeat actions** is the share of members actioned in the range who were
  actioned again within 30 days of an earlier action. The earlier action can be
  from before the range. Automod's entries, unbans and cleared timeouts are
  left out of both the members counted and the repeats, because they do not
  show how often staff had to act on a person. It is shown once at least five
  members were actioned in the range, and not before, since a share of three
  people means little.
- **Automod** appears under the tiles. It counts the warns, timeouts and
  message deletions that automod rules made in the range, which are also part
  of Actions above, with the change from the previous period and the rules that
  fired most. It names the rule from the start of each entry's reason, groups the
  ten busiest and puts the rest under "other", and links to the action log
  filtered to automod. When automod did nothing it says so, which is not the
  same as automod being off.
- **Busiest hours** is a strip of the 24 hours of the day in UTC, shaded by how
  many actions fell in each across the whole range.
- **Moderators** lists who took the actions in the range, busiest first, with
  the mix of warns, timeouts, kicks and bans, the notes they wrote, how many of
  their actions were later removed and when they last acted. Selecting a name
  opens the Actions tab filtered to that person.
- **Most actioned members** is the ten members with the most actions in the
  range.

### The action log

The Actions tab lists every case, newest first. Narrow it by type (warn,
timeout, kick, ban or unban), by state, by source, by moderator, or by searching
the reason, a case number or a member ID. It does not search by name. The source
is **Manual** for entries from staff, by command or from the dashboard, or
**Automod** for the ones automod recorded, and the default is both.

The state of an entry is one of four. *In force* is a timeout or ban that has
not run out and has not been lifted. *Expired* is a timeout whose end time has
passed. *Removed* is an entry staff took off the record. Everything else, such
as a warn or a kick, is simply *On record*.
Admins and the owner see an export button. It downloads a CSV file of the
entries matching the type, state, source, moderator and search you have set, newest first, up
to 5,000 of them. If more match, the file holds the newest 5,000 and you can
narrow the filters and export again for the rest. Removed entries are included.
The file is named `tier0-actions-<server id>-<date>.csv` and has these columns:

| Column | Contents |
| --- | --- |
| `case number` | The case number. |
| `created at` | When the action was taken, in UTC. |
| `member id`, `member name` | The member the action was taken against. |
| `action` | The action, such as `warn` or `timeout`. |
| `reason` | The reason given, if any. |
| `moderator id`, `moderator name` | Who took the action. |
| `state` | `active`, `expired` or `removed`. A warn or kick stays `active` for as long as it is on the record. |
| `expires at` | When a timeout or temporary ban ends, if it does. |
| `removed at`, `removed by`, `removal reason` | Filled in only for removed entries. |

Names are looked up from Discord when the file is made. A name that cannot be
found quickly is left blank, which can happen to the oldest cases in a large
export, and the ID columns are always filled in.

Reasons and member names are typed by other people, so any cell that begins with
`=`, `+`, `-` or `@`, or with a tab or carriage return, has an apostrophe put in
front of it. That stops a spreadsheet from treating it as a formula. The
apostrophe is part of the stored text, so strip it if you load the file into
something other than a spreadsheet.

### Access tab

The owner uses this tab to add staff to a server, change someone between
Moderator and Admin, and remove them. Bots cannot be added. Removing a person
takes away their access and nothing else: the notes and actions they recorded
stay on file. Every change is written to the audit trail. A table on the tab
lists what each level can do, read from the same rules the bot enforces.

### Settings tab

The settings for Moderation and Automod live inside the Moderation area, on its
Settings tab, because they are the same job as the records and statistics
beside them. A switch at the top of the tab moves between the two. They are the
usual settings forms with the usual Save changes bar, and the sidebar no longer
lists them under their own heading. The old addresses for those two pages still
work and send you to the new place, so a bookmark does not break. Quick setup is
unchanged and is still found under Quick setup in the sidebar.

Opening this tab takes Manage Server on the server, like every other feature's
settings. A staff role never grants it, and Manage Server on its own shows this
tab and no other under Moderation.

### The sidebar

The sidebar can shrink to a narrow strip of icons when you want the room. Use
the button in its header, or press Ctrl+B (Cmd+B on a Mac). Hover over or tab to
an icon to see its name. The browser remembers your choice, so the next page and
the next visit open the way you left it. The choice is kept per browser, not per
account. On a phone the sidebar stays a
drawer that you open from the top bar.

## Automod

Seven rules you can switch on separately, each with its own action and its own
exemptions: invites, links, capital letters, repeated text, mention limits,
banned words and rate limiting.

Every rule starts off. Switching the module on does nothing until you pick the
rules you want.

**A word about banned words.** The matching is conservative on purpose. Text
gets lowercased, common letter-for-number swaps are folded back, a letter
stretched out three or more times is collapsed, and then it matches on word
boundaries. So `assassin` will not trip a rule for the rude three letters
inside it.

The cost is that spacing letters out gets past it. Catching that means
stripping whitespace, and stripping whitespace glues unrelated words together
and brings the false positives straight back. Missing a few real cases beats
deleting innocent messages.

Anyone with moderator permissions is exempt by default, and you can turn that
off. When several rules trip on one message you get one action, the most
severe of them.

## Welcome messages

Greetings when someone joins, farewells when they leave, an optional direct
message, and roles handed out on arrival.

Messages support `{user}`, `{username}`, `{server}` and `{memberCount}`. If you
use a placeholder the module does not know, saving fails and tells you which
one, so a typo turns up immediately and not in a greeting three weeks later.

The bot cannot hand out a role positioned above its own. It checks first, logs
it, and carries on with the rest of the join.

## Role menus

Members pick their own roles from a menu you publish to a channel.

**The menus use buttons, not reactions.** Buttons keep working after the
message falls out of the bot's cache, they need no message content permission,
and the member gets a private confirmation with no reaction left sitting on
the message. Publish a menu a second time and it edits the message already
there.

Mark a menu exclusive and picking one option clears the others. Useful for
pronouns or colors, where only one answer makes sense.

## Tickets

A panel with a button on it. A member presses the button, gives a subject, and
gets a private channel with your support team.

The channel denies visibility to the whole server and then grants it back to
the opener, your support roles and the bot. Nobody else sees it, whatever
other roles they hold.

Transcripts are optional and go to a channel you pick when the ticket closes.
Auto-close is optional and its clock resets whenever somebody speaks. A member
who has hit their limit gets told, in those words.

## Audit logging

A record of what changed on the server, written to a channel you pick. Message
edits and deletions, joins and departures, nickname and role changes, channels
and roles created and deleted, bans and unbans. Every category has its own
switch.

Discord sends very little about a deleted or edited message the bot never
cached. Those entries say what is known and leave out what is not, so you do
not get a wall of empty fields. An edit that did not change the text, which is
what you see when a link preview loads, is skipped.

The log channel is never logged about itself. Bot messages are skipped unless
you ask for them.

## News and patch notes

The bot reads sources for you and posts what is new, so announcements reach a
channel whether or not the source can be followed with Discord's own Follow
button.

News feeds take any RSS or Atom address: a site, a subreddit with `.rss` added
to its address, a YouTube channel's feed. Each feed has its own channel, an
optional name shown above the post, and an optional role to ping.

Patch notes are read from Steam, per game, by the number in the game's store
address. The developer's own announcements are used and reposts from news sites
are not. You list the games under each channel, so one channel can carry your
shooters and another your RPGs, and a game can appear under more than one.
Each patch note is an embed with the game's logo, its name and the post's
title, and an optional role to ping per channel. Developers
do not label patch notes consistently, so a post counts when Steam tags it as
patch notes or when its title says so, such as "Patch 2.31" or "Hotfix 1.2".
An announcement that only mentions an update that has not shipped is left out.
What to post is chosen per game: patch notes only, or every announcement the
developer makes. A studio that posts mostly patch notes suits the first, and one
whose announcements are all worth seeing suits the second.

A source's newest item is posted when you first add it, to show it is working,
and only new items after that. A source that suddenly returns a lot of items,
such as a feed that was down for a week, posts at most five and skips the rest
rather than flooding the channel. Sources are checked every 15 minutes by
default and never more often than every 5.

`/feeds status` shows what is being watched, when each source was last checked,
and the reason when one is not working.

`/feeds send` posts the latest items from one feed or game right away, to the
channel it is set up for. Give it part of the feed's name or address, or the
game's name, and a count of up to ten. It posts them whether or not they were
posted before, oldest first, and the scheduled checks will not repeat them. If
what you typed matches more than one source, it lists the matches instead of
guessing.

Only members who can manage the server see `/feeds` by default.

Feed addresses are only fetched from the public internet. An address that
points at the machine the bot runs on, or anything else on its network, is
refused. That matters on an install where people other than the operator can
reach the dashboard.

## Leveling

Experience for taking part, levels earned from it, and roles at whatever
thresholds you choose.

Each message is worth a random amount inside a range you set, so nobody can
count their way to the next level. A cooldown between awards means a burst of
one-word messages is not worth more than a conversation.

Role rewards either stack, keeping everything earned so far, or replace,
keeping only the highest. You can attach a multiplier to a role. When a member
has several, the biggest one applies on its own, so an unplanned combination
of roles cannot spiral.

Rank and the leaderboard are plain Discord embeds. There is no generated image
card. Drawing one pulls in a native dependency that makes every install harder
for what amounts to decoration.

## Utility

Server and member information commands. It is small on purpose. It mostly
exists to prove the module runtime works end to end.
