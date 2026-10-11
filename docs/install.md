# Installing TierZero

This guide covers a fresh install on a machine you control: a home server, a
small VPS, or your own computer. It assumes you can copy a command into a
terminal and edit a text file. It does not assume you write software.

The part people get stuck on is not the install. It is creating the Discord
application, so that comes first and in detail.

## Before you start

You need:

- A machine that stays on. A Raspberry Pi or the cheapest VPS tier is enough.
- [Docker](https://docs.docker.com/get-docker/), or Node 20 and pnpm if you
  would rather run it from source.
- A Discord account, and the Manage Server permission on the server you want
  the bot to run on.

## Step 1: Create the Discord application

Everything the bot needs comes from one application you create once.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and sign in.
2. Press **New Application**, give it a name, and accept the terms. The name is
   what members will see, so use the name you want the bot to have.
3. On **General Information**, copy the **Application ID** and keep it
   somewhere. This is your `DISCORD_CLIENT_ID`.
4. Open the **Bot** tab.
   - Press **Reset Token**, then copy the token. This is your `DISCORD_TOKEN`.
     It is shown once. Lose it and you can just reset it again. Nothing breaks.
   - Turn **Public Bot** off. You are hosting this for yourself, so nobody else
     needs to be able to invite it.
   - Under **Privileged Gateway Intents**, turn on **Server Members Intent**
     and **Message Content Intent**. Without these the bot cannot see who joins
     or read the messages that automatic moderation and leveling depend on, and
     it will refuse to start.
5. Open the **OAuth2** tab.
   - Copy the **Client Secret**. Press **Reset Secret** first if it is hidden.
     This is your `DISCORD_CLIENT_SECRET`.
   - Under **Redirects**, add the address the dashboard will sign you in at,
     then press **Save Changes**:

     ```
     http://localhost:8080/api/auth/callback/discord
     ```

     If you will reach the dashboard at a domain instead of on the machine
     itself, use that, for example
     `https://tierzero.example.com/api/auth/callback/discord`. It has to match
     exactly, including `http` or `https`.

Your token is a password for the bot. Anyone who has it can do anything the bot
can do. Do not put it in a screenshot, a support channel, or a public
repository.

## Step 2: Install

```
git clone https://github.com/Luxrrrr/TierZero.git
cd TierZero
cp .env.example .env
```

Open `.env` and fill in the three values from step 1. Then generate the two
secrets the dashboard signs its sessions with:

```
openssl rand -hex 32
```

Run it twice, once for `AUTH_SECRET` and once for `INTERNAL_API_SECRET`. On
Windows without `openssl`, any long random string of letters and numbers will
do, as long as the two are different.

Leave the rest of the file alone. The defaults are correct for a Docker
install.

```
mkdir -p data
docker compose up -d
```

The first start builds the images, which takes a few minutes. After that it is
seconds.

## Step 3: Invite the bot and sign in

Open the address below in a browser, replacing `YOUR_APPLICATION_ID` with the
Application ID from step 1:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1391837965526&scope=bot%20applications.commands
```

Choose your server and confirm. The permissions requested cover every feature:
managing roles and channels, kicking, banning and timing out members, managing
and reading messages, and viewing the audit log. You can review them on the
invite screen, and none of them are used until you turn the matching feature
on. If you only want some features, you can grant less and re-run this link
later to grant more.

Now open <http://localhost:8080> and sign in with Discord. The first account to
sign in becomes the owner of this install. Your server appears in the list if
you have Manage Server on it and the bot is a member.

Pick your server. The overview lists every feature with a switch beside it, so
turning one on is a single click and happens immediately. A feature that needs
a channel or a role before it can do anything says "Needs setup" until you give
it one.

The sidebar holds the same features, grouped, each with a dot showing whether
it is on. Open one to change its settings. The settings for Moderation and
Automod are the exception: they sit on the Settings tab inside Moderation, next
to the records and statistics, and the sidebar takes you there. A bar appears along the bottom of
the page while you have unsaved edits; Save changes writes them, and the
dashboard only says they are saved once the running bot has picked them up.

The Commands page lists every command on the server. Turn one off to remove it
from Discord here, or restrict it to particular roles and keep it out of
particular channels.

Nothing needs restarting, and a feature's commands only appear in Discord once
that feature is on.

Your moderators do not need Manage Server, and giving it to them would also let
them change settings. Moderation has its own access list instead. Open
Moderation in the sidebar, go to the Access tab, and add each person as a
Moderator or an Admin. You, as the owner of the install, can use Moderation in
every server without being listed. [docs/features.md](features.md#moderation-dashboard)
explains what each level can do.

## Running it from source instead

If you would rather not use Docker:

```
pnpm install
pnpm db:migrate
pnpm --filter @tier0/bot dev     # in one terminal
pnpm --filter @tier0/web dev     # in another
```

Leave `CONTROL_HOST` unset so the bot only listens on the local machine, and
set `CONTROL_API_URL=http://127.0.0.1:8081`.

## Keeping it running

**Updating.** Pull the new version and rebuild:

```
git pull
docker compose up -d --build
```

Database changes are applied automatically when the dashboard starts. If you
run from source, run `pnpm db:migrate` after pulling.

**Upgrading to the moderation dashboard.** This version adds the Moderation area
and changes how moderation cases are stored. It brings two database changes. The
first adds three tables, for staff notes, the audit trail and the list of staff,
and rebuilds the table that holds cases so each one carries its own stored case
number, plus the details of a removal. The second gives each server a counter
for case numbers, starting at the highest number already in use. Every existing
case keeps the number it had, and the next case follows it. Nothing needs doing by
hand, but copy `data/tier0.db` somewhere safe before you update (see Backups
below), because database changes only go forward and returning to the old
version means restoring that copy.
The dashboard applies the change as it starts, so give it a few seconds to come
up before relying on the moderation commands.

Until you add them, nobody except you, as the owner of the install, can open
Moderation.

**Backups.** Everything is in `data/tier0.db`. Copy that file somewhere safe.
Stop the containers first if you want to be certain of a clean copy:

```
docker compose stop
cp data/tier0.db ~/tier0-backup.db
docker compose start
```

**Logs.** `docker compose logs -f bot` and `docker compose logs -f web`.

## Putting it on a domain

The dashboard is the only part that should ever be reachable from the internet.
The bot's control API listens on the private network between the two
containers and its port is never published.

Point a reverse proxy at port 8080, give it a certificate, then update two
things: `DASHBOARD_URL` in `.env`, and the redirect address in the Discord
Developer Portal, which must match the new one exactly.

**Signing in from another device.** The dashboard tells Discord to send you back
to whatever address you opened it at, so that address must be one Discord will
accept and one you have added to the Redirects list in the Developer Portal
(with `/api/auth/callback/discord` on the end). Discord answers "redirect_uri:
Not a well formed URL" for a bare machine name such as `http://my-pc:8080`; it
wants a name with a dot in it. On Tailscale that means the full name, for
example `http://my-pc.tailnet-name.ts.net:8080`, which `tailscale status` shows
as the machine's DNS name. Add each address you sign in from as its own
redirect, and keep the `localhost` one for signing in on the machine itself.

**Pass the host through.** When someone saves a note, removes an action or
changes the staff list, the dashboard only accepts the request if the address
the browser says it came from matches the address the request was sent to. It
compares against the `Host` header, or the first value of `X-Forwarded-Host`.
A proxy that rewrites `Host` to its own internal name and sends no
`X-Forwarded-Host` makes every one of those saves fail with "This request did
not come from the dashboard". nginx replaces `Host` by default, so with nginx
add `proxy_set_header Host $host;` to the location that points at the dashboard.
Reading pages is not affected, only changes.

**Keep the control API private.** The bot's control API, port 8081, trusts
whoever holds `INTERNAL_API_SECRET`, and the dashboard is the only thing meant
to hold it. Do not publish that port or point the proxy at it. Under Compose the
bot listens on all interfaces because that is how the dashboard container
reaches it, which is safe only while the port stays unpublished. Running from
source, leave `CONTROL_HOST` unset and the bot listens on the local machine
only.

**Sign-in lookups can be briefly out of date.** To decide which servers someone
can manage, the dashboard asks Discord for their server list and reuses the
answer for a minute. If Discord is having problems, an answer up to 15 minutes
old is used so people are not locked out in the middle of a Discord outage. It
is used only when Discord could not be reached or was overloaded. If Discord
refuses the request, the old answer is not used. Access to Moderation is
decided by your own staff list and does not depend on this lookup.

## When something is wrong

**The bot will not start and the log mentions disallowed intents.** Server
Members Intent or Message Content Intent is switched off in the Developer
Portal. Turn both on and restart.

**The dashboard says the bot is not responding.** The bot container is not
running or cannot be reached. Check `docker compose ps` and
`docker compose logs bot`.

**Signing in fails after choosing Discord.** The redirect address in the
Developer Portal does not match the one the dashboard is served at. They have
to be identical, including `http` against `https` and any trailing path.

**Your server is not in the list.** You need Manage Server on it, and the bot
has to be a member. Both, not either.

**Saving a note or removing an action fails with "This request did not come from
the dashboard".** The dashboard is behind a reverse proxy that does not pass the
original host through. See "Putting it on a domain" above.

**Someone on your team signs in and sees no servers.** They are not on the
Moderation access list for that server and do not have Manage Server. Add them
on the Access tab under Moderation, as the owner of the install.

**Moderation says it has no statistics, or the Audit tab is missing.** After an
update the bot may still be running the old version. Restart it with
`docker compose up -d --build` and reload the page. The Audit tab is there only
for admins and the owner, which is intended.

**Commands do not appear in Discord.** A feature's commands only exist while
that feature is on. Turn it on and give it a few seconds. Registration is held
back a few seconds by design, so flipping several switches at once sends one
request and not six.
