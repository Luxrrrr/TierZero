# Features

Every feature is a module. You switch modules on per server from the dashboard
and the change takes effect straight away. A module you have not switched on
does nothing at all.

Most settings are optional. Leave one blank and that part of the module stays
quiet.

This page covers the things you would not guess from the settings screen. The
dashboard explains each individual field as you fill it in.

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
