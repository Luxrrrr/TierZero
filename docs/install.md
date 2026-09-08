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
     It is shown once. If you lose it, reset it again; nothing breaks.
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

     If you will reach the dashboard at a domain rather than on the machine
     itself, use that instead, for example
     `https://tierzero.example.com/api/auth/callback/discord`. It has to match
     exactly, including `http` or `https`.

Your token is a password for the bot. Anyone who has it can do anything the bot
can do. Do not put it in a screenshot, a support channel, or a public
repository.

## Step 2: Install

```
git clone https://github.com/OWNER/tier0.git
cd tier0
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

Pick your server, turn on the features you want, and save. Changes take effect
immediately. Nothing needs restarting, and commands for a feature only appear
in Discord once that feature is on.

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

Database changes are applied automatically when the dashboard starts.

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

**Commands do not appear in Discord.** A feature's commands only exist while
that feature is on. Turn it on, save, and give it a few seconds. Registration
is deliberately delayed slightly so that changing several things at once does
not send a request for each.
