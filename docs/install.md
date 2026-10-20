# Quick install

For a step-by-step version with every term explained, see the [beginner guide](install-beginner.md).

You need a computer to run it on, Docker, a Discord account, and a Discord server where you have the Manage Server permission. Without Docker, see [running from source](#running-from-source).

You can run it on your own PC, but the bot is only online while TierZero is running. If that PC is switched off, asleep or without internet, the bot is offline too. For a server people rely on, use something that stays on: an old PC or laptop, a Raspberry Pi, or the cheapest VPS tier. Any of those is enough.

Manage Server is one of Discord's own permissions. It's set on roles under Server Settings, Roles, and the server owner always has it. It isn't part of TierZero. Discord requires it to add a bot to a server, and the dashboard only lists servers where you have it, so it decides who can configure the bot.

## In short

1. Create a Discord application and copy its token, client ID and client secret.
2. Clone the repo, copy `.env.example` to `.env`, fill in those three plus two random secrets.
3. `docker compose up -d`.
4. Invite the bot with the OAuth link and sign in at `localhost:8080`.

Everything after that is optional: giving moderators access, putting the dashboard on a domain, updating and backups.

## Contents

- [1. Create the Discord application](#1-create-the-discord-application)
- [2. Install](#2-install)
- [3. Invite the bot and sign in](#3-invite-the-bot-and-sign-in)
- [4. Configure it](#4-configure-it), including [moderator access](#moderator-access)
- [Reaching the dashboard from other devices](#reaching-the-dashboard-from-other-devices): Cloudflare Tunnel, Tailscale, your own reverse proxy
- [Updating](#updating) and [backups](#backups)
- [Running from source](#running-from-source)
- [Troubleshooting](#troubleshooting)

## 1. Create the Discord application

You'll copy three values from here into `.env`, so do this first.

1. Open the [Developer Portal](https://discord.com/developers/applications), click **New Application** and give it the name you want the bot to have.
2. On **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. On the **Bot** tab:
   - Click **Reset Token** and copy it. This is `DISCORD_TOKEN`. Discord shows it once. If you lose it, reset it again.
   - Turn **Public Bot** off.
   - Under **Privileged Gateway Intents**, turn on **Server Members Intent** and **Message Content Intent**. The bot won't start without them.
4. On the **OAuth2** tab, copy the **Client Secret** (click **Reset Secret** if it's hidden). This is `DISCORD_CLIENT_SECRET`. Under **Redirects**, add the address below and save:

   ```
   http://localhost:8080/api/auth/callback/discord
   ```

   If you'll open the dashboard at a domain, add that instead, for example `https://tierzero.example.com/api/auth/callback/discord`. It has to match what's in your browser's address bar exactly, down to `http` versus `https`.

Don't share the token or the client secret. The token controls the bot. The secret lets someone else pass themselves off as your dashboard's sign-in.

## 2. Install

```
git clone https://github.com/Luxrrrr/TierZero.git
cd TierZero
cp .env.example .env
mkdir -p data
```

Open `.env` and fill in the three Discord values. `AUTH_SECRET` and `INTERNAL_API_SECRET` need a random string each, and they have to be different from each other. The dashboard uses the first to secure its login cookies and the second to authenticate to the bot. Generate each with OpenSSL:

```
openssl rand -hex 32
```

Each run prints 64 random hex characters. macOS and most Linux distributions already have `openssl`. On Debian or Ubuntu without it, run `sudo apt install openssl`. On Windows, it comes with Git for Windows (use Git Bash). If you'd rather not install anything, this PowerShell line does the same job. Run it twice:

```
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

Leave the other values alone. The defaults are correct for Docker.

```
docker compose up -d
```

The first run builds both images and takes a few minutes.

## 3. Invite the bot and sign in

Open this link, replacing `YOUR_APPLICATION_ID` with the Application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1495472270550&scope=bot%20applications.commands
```

Choose your server and confirm. The link requests every permission any feature uses: View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis, Mention @everyone, Manage Messages, Manage Channels, Manage Roles, Manage Webhooks, Manage Threads, Create Public Threads, Create Private Threads, Connect, Move Members, Kick, Ban, Timeout Members and View Audit Log. A permission isn't used until you switch on the feature that needs it. If you only want some features, grant fewer permissions now and open the link again later. A feature that is missing one says so on the server's overview. The **Invite** button on Your servers uses the same link. The number is also in `apps/web/lib/invite.ts`, with what each permission is for.

Then open <http://localhost:8080> and sign in with Discord. The owner of the install is the Discord account that owns the bot's application in the Developer Portal, which is normally you. The bot reads that when it connects, so there is nothing to claim. If the bot isn't online yet, the dashboard shows a waiting screen until it is. `INSTANCE_OWNER_ID` in `.env` names a different owner and always wins, which is how you hand the install to someone else or name the owner of a team application. The owner can use the moderation area on every server and decides which other people can (see [Moderator access](#moderator-access)). Your server is listed if you have Manage Server on it and the bot is a member.

## 4. Configure it

Select your server. The overview lists every feature with a switch, and switching one on takes effect immediately. A feature that's missing a channel or role shows **Needs setup**.

- **Quick setup** in the sidebar asks only for the settings a feature can't work without.
- Each feature has a settings page. Unsaved changes collect in a bar at the bottom of the page. The dashboard reports them as saved once the running bot has applied them.
- **Commands** lists every command on the server. Each can be switched off, or limited to certain roles and channels.

### Moderator access

For a moderator to use the dashboard, two things have to be true: they can reach it, and you've added them to the access list.

**Reaching it.** The dashboard opens at `localhost:8080` on the machine running TierZero. Other devices on your home network or Tailscale can also open it at that machine's address, such as `http://192.168.1.20:8080`, as long as the address is added under Redirects in the Developer Portal like the `localhost` one. That connection is plain HTTP. For moderators outside your home network, use either a public domain with a Cloudflare Tunnel or Tailscale. Both are covered in [Reaching the dashboard from other devices](#reaching-the-dashboard-from-other-devices). If you're the only person using the dashboard, you don't need either.

**The access list.** Moderation has its own list of who's allowed in. Open **Moderation**, go to the **Access** tab and add each person as Moderator or Admin. The owner is the only person who can use it without being added. [Features](features.md#moderation-dashboard) lists what each level can do.

The list is separate from Discord's Manage Server permission on purpose. Giving a moderator Manage Server would also let them change TierZero's settings in the dashboard.

## Reaching the dashboard from other devices

The dashboard answers on every address the machine has, over plain HTTP, so anything on your home network or Tailscale can open it. Anything that can reach the machine from the internet can too, which happens on a rented server (VPS) or if you forward port 8080 on your router. Sign-in still needs a Discord account you've given access to, but the connection isn't encrypted, so don't leave it open to the internet. For moderators outside your home network, pick one:

| | Cloudflare Tunnel | Tailscale | Your own reverse proxy |
| --- | --- | --- | --- |
| Who can reach it | Anyone with the address, then they sign in with Discord | Only you and the people you share the machine with, from any network, and only the port you allow | Anyone with the address, then they sign in |
| You need | A domain on Cloudflare | A free Tailscale account, installed on every device | A domain, a certificate and a proxy you manage |
| Ports to open on your router | None | None | 80 and 443 |

If you don't follow this section, the [beginner guide](install-beginner.md#optional-let-moderators-use-the-dashboard-from-anywhere) walks through it step by step.

### Running it on a server

On a VPS or any machine with a public address, stop the dashboard answering on the public side. Add this to `.env`:

```
DASHBOARD_BIND=127.0.0.1
```

Then run `docker compose up -d`. The dashboard now only answers on the machine itself, and a Cloudflare Tunnel or your own reverse proxy gives people HTTPS from outside. Don't count on the server's firewall to do this job. Docker publishes ports around most firewalls, including `ufw`, so a port you meant to keep closed can still be open.

### Cloudflare Tunnel (recommended)

A Cloudflare Tunnel is the easiest way to put it on a public domain. A small program called `cloudflared` runs next to TierZero and makes an outbound connection to Cloudflare. Cloudflare then serves your dashboard on your domain over HTTPS. You don't open any ports on your router, you don't manage a certificate, and your home IP isn't exposed. It's free, but you need a domain whose DNS is on Cloudflare.

1. Create a tunnel in the Cloudflare dashboard (Zero Trust, Networks, Tunnels) and run the connector command it gives you on the machine running TierZero. Cloudflare's [tunnel guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) has the current steps, since their menus move around.
2. Add a public hostname, such as `tierzero.example.com`, with the service set to `http://localhost:8080`. If `cloudflared` itself runs in Docker, `localhost` there means the container, so point it at the host instead (`http://host.docker.internal:8080` on Docker Desktop).
3. In the Discord Developer Portal, add `https://tierzero.example.com/api/auth/callback/discord` under Redirects, using your own hostname. Keep the `localhost` one.

That's all. `cloudflared` passes the original host through, so the header issue below doesn't apply. The dashboard works out its own address from each request, so there's no setting to change in `.env`.

### Tailscale

Tailscale links your devices into a private network, called a tailnet, over the internet. The devices don't need to be on the same local network. A phone on mobile data with Tailscale connected can reach your home machine the same way a laptop on your Wi-Fi can. Nothing outside the tailnet can reach it. It's a good fit when the people who need the dashboard are few and you can install an app on their devices, since there's no domain to buy and nothing public to expose.

You share the machine running TierZero with each moderator. Tailscale's sharing gives the person access to that one machine and nothing else in your tailnet. They can't see your other devices, and the shared machine can't start connections to theirs. What sharing doesn't do on its own is limit which ports on that machine they can reach. Tailscale's default policy allows everything, and your policy applies to the people you share with, so by default they could reach every port on the machine: Remote Desktop, file sharing, anything listening. Step 4 closes that, so do it before you share.

1. Install [Tailscale](https://tailscale.com/download) on the machine running TierZero and sign in. Note two things about it: its full name, which looks like `my-pc.tailnet-name.ts.net` and is on the Machines page of the admin console, and its Tailscale IP, which starts with `100.` and shows in the same place or with `tailscale ip -4`.
2. In the Discord Developer Portal, add `http://my-pc.tailnet-name.ts.net:8080/api/auth/callback/discord` under Redirects, using your machine's full name. Keep the `localhost` one.
3. Check you can open `http://my-pc.tailnet-name.ts.net:8080` on a device of your own with Tailscale connected, and sign in.
4. Limit what shared people can reach. In the admin console, open the [Access controls](https://console.tailscale.com/admin/acls) page and edit the policy file. Two rules matter: your own devices keep full access, and anyone you share with can reach TCP port 8080 on the TierZero machine and nothing else. Use your machine's Tailscale IP and your own Tailscale account email:

   ```
   {
     "grants": [
       // Your own devices keep full access.
       { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },

       // People you share the TierZero machine with can reach port 8080 on it only.
       { "src": ["autogroup:shared"], "dst": ["100.101.102.103"], "ip": ["tcp:8080"] }
     ],

     "tests": [
       // Tailscale refuses to save the policy if this stops being true,
       // so a mistake can't cut you off from your own machine.
       { "src": "you@example.com", "proto": "tcp", "accept": ["100.101.102.103:3389"] }
     ]
   }
   ```

   The first rule replaces the default allow-everything rule. If your policy file has more than the default, such as tagged devices, subnet routers or SSH rules, keep those sections and rules, and make sure no rule still has `"src": ["*"]` pointing at the TierZero machine. A source of `*` applies to people you've shared with too, and would undo the limit. Port 3389 in the test is Remote Desktop. Use any port you rely on.
5. Share the machine with each moderator. On the Machines page, open the menu on the TierZero machine, choose **Share**, then **Share by email**, and enter their email. Use email invites, not the shareable link, so you know exactly who has access. They accept with their own Tailscale account, and they don't need to use the invited email.
6. The moderator installs Tailscale, signs in and accepts the share. They open `http://my-pc.tailnet-name.ts.net:8080` and sign in with Discord. A shared machine can only be reached by its full name, so the short name won't work for them. Then add them on the **Access** tab.

To remove someone's access, open **Share** on the machine and choose **Revoke invite** from the menu on their invite. They lose access right away, and they'd need a new invite and acceptance to get it back.

Dedicated hardware avoids the question altogether. If TierZero runs on its own machine, like a Raspberry Pi or a small server, then the only thing a moderator can ever reach is that machine.

For your own devices, the short name (`http://my-pc:8080`) also reaches the dashboard through MagicDNS. Discord rejects a redirect address without a dot in the host, so signing in from it fails with "Not a well formed URL". Open the full name whenever you sign in.

### Your own reverse proxy

Nginx, Caddy or Traefik work too. Point the proxy at port 8080, give it a certificate, and add the redirect in the Developer Portal as above.

One thing to check. When you save something in the dashboard (a setting, a command change, a note, a removal, a staff change), the dashboard makes sure the request came from its own page and not from some other website tricking your browser into sending it. It does that by comparing the site address the browser reports in the `Origin` header with the `Host` header, or the first `X-Forwarded-Host`, that the request arrived with. If your proxy replaces `Host` with an internal name and doesn't set `X-Forwarded-Host`, the two never match and every save fails with "This request did not come from the dashboard". Nginx replaces `Host` by default, so add this to the location block:

```
proxy_set_header Host $host;
```

Caddy and Cloudflare Tunnel pass it through by default. Reading pages isn't affected, only saves.

The dashboard also refuses to sign anyone in over plain HTTP at an address the internet can reach, since the session would cross the network unencrypted. It knows a connection is HTTPS when the proxy sends `X-Forwarded-Proto: https`. Caddy and Cloudflare Tunnel send it. For nginx, add `proxy_set_header X-Forwarded-Proto $scheme;`. Home network, Tailscale and `localhost` addresses are never affected. If you see the "This connection isn't private" screen and you know the address is private, set `ALLOW_INSECURE_HTTP=true` in `.env`.

### Things that apply either way

Only the dashboard should be reachable from outside. The bot's control API listens on the private network between the two containers, and Docker Compose doesn't publish its port. Keep it that way. Anyone holding `INTERNAL_API_SECRET` can use the API, and only the dashboard should have it.

Every address you sign in from needs its own entry under Redirects in the Developer Portal, so add one for each way you reach the dashboard.

To decide which servers you can manage, the dashboard asks Discord for your server list and reuses the answer for a minute. If Discord is erroring or rate limiting, it reuses the last good answer for up to 15 minutes. If Discord rejects the request itself, it doesn't. Moderation access comes from your own list and doesn't use this lookup.

## Updating

```
git pull
docker compose up -d --build
```

The dashboard's **Updates** page tells you which version you are on and whether a newer one is out, and lists what changed. It does not apply the update for you, since that needs a terminal on this machine. The sidebar shows a dot on Updates when a new version is available.

The page asks GitHub for the latest releases and the roadmap, and sends nothing about your install. The owner can turn that off on the Updates page, and then the dashboard makes no request to GitHub at all.

Database migrations run when the dashboard starts. They only go forward, so copy `data/tier0.db` before updating. To go back to an older version, restore the copy.

## Backups

All data is in `data/tier0.db`. Stop the containers first for a consistent copy:

```
docker compose stop
cp data/tier0.db ~/tier0-backup.db
docker compose start
```

Logs are in `docker compose logs -f bot` and `docker compose logs -f web`.

## Running from source

```
pnpm install
pnpm db:migrate
pnpm --filter @tier0/bot dev     # one terminal
pnpm --filter @tier0/web dev     # another
```

Leave `CONTROL_HOST` unset so the bot only listens on localhost, and set `CONTROL_API_URL=http://127.0.0.1:8081`.

## Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| Bot won't start, log mentions disallowed intents | Server Members Intent or Message Content Intent is off | Turn both on in the Developer Portal, then restart |
| Dashboard says the bot isn't responding | The bot container is stopped or unreachable | `docker compose ps`, then `docker compose logs bot` |
| Sign-in fails after choosing Discord | The redirect in the Developer Portal doesn't match the address in your browser | Make them identical, including `http` versus `https` |
| "Not a well formed URL" from Discord | The dashboard address has no dot in its host | Use the full name (the `.ts.net` one on Tailscale) and add it as a redirect |
| A moderator can't open the dashboard at all | They aren't on your home network or Tailscale, or `DASHBOARD_BIND` is set to `127.0.0.1` | See [Reaching the dashboard from other devices](#reaching-the-dashboard-from-other-devices) |
| Your server isn't listed | You lack Manage Server there, or the bot isn't a member | You need both |
| "This request did not come from the dashboard" when saving | The reverse proxy isn't passing the host through | See [Reaching the dashboard from other devices](#reaching-the-dashboard-from-other-devices) |
| Mod log posts have no View in dashboard button, or it opens the wrong address | The bot learns the address from the owner opening the dashboard, and hasn't yet, or saw a different one | Open the dashboard once at the address your moderators use, or type it into **Dashboard address** in the moderation settings |
| Channel or role lists won't load | Discord rate limited the server list lookup | Wait 30 seconds and reload |
| A teammate signs in and sees no servers | They aren't on the Moderation list and lack Manage Server | Add them on the Access tab |
| No moderation statistics, or no Staff activity page | The bot is running an old version, or you aren't an admin | Run `docker compose up -d --build`. Only admins and the owner see Audit |
| Commands don't show up in Discord | A feature's commands only exist while it's switched on | Switch the feature on and wait a few seconds |
