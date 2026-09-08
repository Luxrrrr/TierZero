# Features

Every feature is a module. Modules are switched on per server from the
dashboard and take effect immediately, and each one does nothing at all until
you turn it on. Where a setting is optional, leaving it unset means that part
of the module stays quiet rather than erroring.

This page covers the behaviour that is not obvious from the settings
themselves. The dashboard explains each individual field as you configure it.

## Moderation

Warnings, timeouts, kicks, bans and temporary bans, each recorded as a numbered
case you can look up later.

**Hierarchy is enforced on every action.** A moderator cannot action anyone
whose highest role sits at or above their own, and the bot cannot action anyone
above itself. The server owner cannot be actioned by anybody. This is checked
before the request reaches Discord, so the refusal explains itself instead of
arriving as a permissions error.

**Temporary bans schedule their own reversal.** The pending unban is a database
row, not a timer, so restarting the bot does not strand someone. Unbanning by
hand cancels the pending one.

Timeouts use Discord's own timeout, which it caps at 28 days; anything longer
is refused with an explanation rather than silently shortened. Bulk deletion
cannot touch messages older than 14 days, which is Discord's limit, and the
command says so rather than partly succeeding.

Cases stay after the action is reversed. An unban marks the ban inactive rather
than deleting it, so history remains readable.

## Automod

Seven rules, each switched on separately with its own action and its own
exemptions: invites, links, capital letters, repeated text, mention limits,
banned words and rate limiting.

Every rule is off by default. Turning the module on does nothing until you
choose which rules you want.

**On banned words**, matching is deliberately conservative. Text is lowercased,
common letter-for-number substitutions are folded, and a letter stretched three
or more times is collapsed, then matched on word boundaries. That means
`assassin` does not trip a rule for a rude three-letter word contained inside
it. It also means spaced-out evasion is not caught: closing that gap requires
stripping whitespace, which glues unrelated words together and brings the false
positives straight back. Catching fewer real cases is the better trade when the
alternative is deleting innocent messages.

Members with moderator permissions are exempt by default, and that default can
be turned off. If several rules trip on one message, the most severe action is
taken once.

## Welcome messages

Greetings when someone joins, farewells when they leave, optional direct
messages, and roles assigned on arrival.

Messages support `{user}`, `{username}`, `{server}` and `{memberCount}`. A
placeholder the module does not recognise is rejected when you save, so a typo
surfaces immediately rather than appearing verbatim in a greeting weeks later.

A role positioned above the bot's own cannot be assigned. That is checked
before the attempt, logged, and does not stop the rest of the join being
handled.

## Role menus

Members pick their own roles from a menu you publish to a channel.

Menus use **buttons rather than reactions**. Buttons keep working when a
message falls out of the bot's cache, need no message content permission, and
give the member a private confirmation instead of leaving a reaction sitting on
the message. Publishing a menu again edits the existing message rather than
posting a second one.

A menu can be exclusive, so picking one option clears the others. That suits
pronouns or colours, where only one answer makes sense.

## Tickets

A panel with a button. A member presses it, gives a subject, and gets a private
channel with your support team.

The channel is created with the whole server denied visibility and explicit
access granted to the opener, the support roles and the bot. Nobody else can
see it regardless of what other roles they hold.

Transcripts are optional and post to a channel you choose when the ticket
closes. Auto-close is optional and resets whenever somebody speaks. A member at
their open ticket limit is told so.

## Audit logging

A record of what changed on the server, written to a channel you pick. Message
edits and deletions, joins, departures, nickname and role changes, channel and
role creation and deletion, bans and unbans, each switched separately.

Deleted and edited messages are often not in the bot's cache, in which case
Discord sends very little about them. Those entries say what is known rather
than printing empty fields. Edits where the content did not actually change,
which happens when a link preview loads, are not logged.

The log channel is never logged about itself, and bot messages are ignored
unless you ask for them.

## Leveling

Experience for taking part, levels from that experience, and roles at
thresholds you choose.

Experience per message is a range rather than a fixed number, so it cannot be
counted exactly and gamed. A cooldown between awards stops a burst of short
messages from being worth more than a conversation.

Role rewards can stack, keeping every role earned so far, or replace, keeping
only the highest. Multipliers can be attached to roles; where several apply,
the highest is used rather than multiplying them together, so a combination
nobody planned cannot produce a runaway rate.

Rank and the leaderboard are Discord embeds. There is deliberately no generated
image: drawing one needs a native dependency that complicates every install for
something that is decoration.

## Utility

Server and member information commands. Small on purpose; it exists mostly to
exercise the module runtime end to end.
