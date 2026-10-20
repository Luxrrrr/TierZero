# Beginner guide

This takes you from nothing to a running bot. You don't need to know how to code. You'll download a file, click through some Discord pages and paste a few lines into a terminal.

If you're already comfortable with a terminal, the [quick install](install.md) is shorter.

## The short version

1. Install Docker.
2. Download TierZero.
3. Create a Discord application and copy three values from it.
4. Paste those values into a settings file.
5. Run one command to start it.
6. Add the bot to your server and sign in.

The Discord part (step 4 below) is the slowest. The last section is optional and covers letting your moderators use the dashboard from their own devices.

## Contents

- [Before you start](#before-you-start)
- [Step 1: Install Docker](#step-1-install-docker)
- [Step 2: Download TierZero](#step-2-download-tierzero)
- [Step 3: Open a terminal in that folder](#step-3-open-a-terminal-in-that-folder)
- [Step 4: Create the Discord application](#step-4-create-the-discord-application)
- [Step 5: Fill in the settings file](#step-5-fill-in-the-settings-file)
- [Step 6: Start TierZero](#step-6-start-tierzero)
- [Step 7: Add the bot to your server](#step-7-add-the-bot-to-your-server)
- [Step 8: Sign in](#step-8-sign-in)
- [Step 9: Switch a feature on](#step-9-switch-a-feature-on)
- [Keeping it running, updating and backups](#keeping-it-running-updating-and-backups)
- [If something goes wrong](#if-something-goes-wrong)
- [Optional: let moderators use the dashboard from anywhere](#optional-let-moderators-use-the-dashboard-from-anywhere)

## Before you start

You need three things.

**A computer to run it on.** Your own PC works, and it's the easiest way to try this out. The bot is only online while TierZero is running, though. When you switch that PC off, put it to sleep or lose internet, the bot goes offline too. For a server people rely on, use something that stays on: an old PC or laptop, a Raspberry Pi or a rented server.

**A Discord account.**

**A Discord server where you have the Manage Server permission.** This is a Discord permission and not something TierZero adds. If you created the server, you have it. If you didn't, ask the owner for a role that includes it (Server Settings, then Roles). Discord requires it to add a bot, and TierZero's dashboard only lists servers where you have it.

## Step 1: Install Docker

Docker runs TierZero in a self-contained package, so you don't install its parts yourself.

1. Go to [Docker's download page](https://docs.docker.com/get-docker/) and get **Docker Desktop** for your system.
2. Run the installer. If it asks to enable WSL 2 or to restart, say yes.
3. Open Docker Desktop. Accept the terms if it asks. You don't have to sign in.
4. Wait until it shows that Docker is running. On Windows there's a whale icon by the clock.
5. Open Docker Desktop's settings and turn on **Start Docker Desktop when you sign in**. Without it, TierZero stays down after a restart until you open Docker yourself.

## Step 2: Download TierZero

1. Go to [github.com/Luxrrrr/TierZero](https://github.com/Luxrrrr/TierZero).
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it somewhere you'll find again, such as Documents. You'll get a folder called `TierZero-main`.

Keep that folder. TierZero's settings and data live inside it, so deleting or moving it later affects the bot.

## Step 3: Open a terminal in that folder

- **Windows 11:** open the `TierZero-main` folder, right-click an empty spot in it and choose **Open in Terminal**.
- **Windows 10:** open the folder, click the address bar, type `powershell` and press Enter.
- **Mac:** right-click the folder and choose **New Terminal at Folder**. If that isn't there, open Terminal, type `cd ` with a space after it, drag the folder onto the window and press Enter.

A window opens with a line of text and a blinking cursor. From here on, anything in a gray box is something you type or paste there, followed by Enter. To paste, use Ctrl+V (Cmd+V on Mac). In an older PowerShell window, right-click does it.

Run these two lines, one at a time:

```
copy .env.example .env
mkdir data
```

On Mac and Linux, use `cp` instead of `copy`:

```
cp .env.example .env
mkdir data
```

The first line creates your settings file. The second creates the folder where TierZero keeps its data.

## Step 4: Create the Discord application

A Discord application is the record Discord keeps for your bot. It holds the bot's name, its login token, and the settings the dashboard uses to sign people in. You'll copy three values from it. Open a notepad and paste each one in with its label as you go.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and sign in.
2. Click **New Application** in the top right. Name it what you want the bot to be called. That name is what members see. Accept the terms and click **Create**.

**Value 1: the Application ID.** You land on **General Information**. Find **Application ID**, click **Copy** and paste it into your notepad as `DISCORD_CLIENT_ID`.

**Value 2: the bot token.**

1. In the left menu, click **Bot**.
2. Click **Reset Token** and confirm. Discord may ask for your password.
3. Click **Copy** next to the token. Paste it into your notepad as `DISCORD_TOKEN`.

The token is what lets the bot log in to Discord. Discord shows it once. If you lose it, click **Reset Token** again for a new one.

Also on the Bot page:

- Turn **Public Bot** off, so nobody else can add your bot to their servers.
- Scroll to **Privileged Gateway Intents** and turn on **Server Members Intent** and **Message Content Intent**. Click **Save Changes**. The bot needs these to see who joins and what's posted, and it won't start without them.

**Value 3: the client secret.**

1. In the left menu, click **OAuth2**.
2. Find **Client Secret**. If it's hidden, click **Reset Secret**. Copy it and paste it into your notepad as `DISCORD_CLIENT_SECRET`. This one lets the dashboard sign people in, and it's separate from the token. You need both.

On the same page, find **Redirects**, click **Add Redirect** and paste this exactly:

```
http://localhost:8080/api/auth/callback/discord
```

Click **Save Changes**. Without this, Discord won't send you back to your dashboard after you sign in.

The token and the client secret are passwords. Don't post them or screenshot them.

## Step 5: Fill in the settings file

In the terminal, run:

```
notepad .env
```

On Mac, run `open -e .env` instead.

A text editor opens with a list of settings. Find these three lines and paste your values after the equals sign, with no spaces and no quotes:

```
DISCORD_TOKEN=MTIzNDU2.abcdef.your-very-long-token
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your-client-secret
```

`AUTH_SECRET` and `INTERNAL_API_SECRET` need a random string each. The dashboard uses them to secure its login cookies and to talk to the bot, and you'll never type them again. Generate one by pasting this into the terminal:

```
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

It prints 64 letters and numbers. Paste them after `AUTH_SECRET=`. Run it again and paste the new result after `INTERNAL_API_SECRET=`. The two must be different.

On Mac, the command is `openssl rand -hex 32`.

Leave every other line as it is. Save with Ctrl+S (Cmd+S on Mac) and close the editor.

## Step 6: Start TierZero

Make sure Docker Desktop is running, then run:

```
docker compose up -d
```

The first time, it downloads and builds everything it needs. That takes a few minutes and prints a lot of text. When the terminal prompt comes back and the last lines say `Started`, it's running. If you see red error text instead, go to [If something goes wrong](#if-something-goes-wrong).

## Step 7: Add the bot to your server

Paste this into your browser's address bar. Replace `YOUR_APPLICATION_ID` with the Application ID from your notepad before you press Enter:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1495472270550&scope=bot%20applications.commands
```

Choose your server and click **Authorize**. The bot appears in your member list. It asks for every permission its features might need, and it doesn't use one until you switch on the feature that needs it. Leave them all ticked: if one is missing later, the feature it belongs to says so on your server's overview. The Invite button on the dashboard's **Your servers** page uses the same link.

## Step 8: Sign in

1. Open your browser and go to <http://localhost:8080>. That address means port 8080 on this computer, which is where the dashboard runs.
2. Choose to sign in with Discord and approve.

You are the owner of the install if you are the person who created the bot's application in step 4. TierZero asks Discord who owns that application, so there is nothing to click. The owner can use the moderation part of the dashboard on every server, decides who else can, and installs updates. If you see **Waiting for the bot** instead, the bot hasn't started or can't log in yet. Check that the bot's token in `.env` is right and try again.

Your server appears in the list. If it doesn't, you need the Manage Server permission there and the bot has to have joined it in step 7. You need both.

## Step 9: Switch a feature on

Click your server. Every feature has a tile with a switch, and all of them start off.

Try **Utility** first, because you can see it work. Switch it on, wait a few seconds, then type `/ping` in any channel of your server. The bot replies. If you see the reply, everything is working.

Then switch on whatever you want. If a tile says **Needs setup**, it needs a channel or role from you. Open it, choose one and click **Save changes**. A bar appears at the bottom of the page whenever you have unsaved changes.

Changes apply immediately. You never need to restart anything to switch a feature on or off. **Quick setup** in the sidebar walks through the other features and asks only for the settings each one can't work without, one feature per screen.

## Keeping it running, updating and backups

**Keeping it running.** TierZero runs while Docker Desktop is running. After a reboot, Docker Desktop starts again if you turned on that setting in step 1, and it brings TierZero back with it. To stop TierZero, run `docker compose stop` in the TierZero folder. To start it again, run `docker compose start`.

**Backups.** Everything TierZero stores is in the `data` folder, in a file called `tier0.db`. Run `docker compose stop`, copy that file somewhere safe, then run `docker compose start`. Do this before updating.

**Updating.** Download the new ZIP, unzip it, and copy its contents over your existing `TierZero-main` folder, replacing files when asked. Your `.env` file and `data` folder aren't in the ZIP, so they stay as they are. Then, in the terminal in that folder, run:

```
docker compose up -d --build
```

## If something goes wrong

**Docker says it can't connect, or that the daemon isn't running.** Docker Desktop isn't open. Open it, wait until it shows that it's running, and try again.

**Docker Desktop won't start on Windows.** It needs virtualization turned on. If the installer or the app mentions WSL 2 or virtualization, check that it's enabled in your computer's BIOS settings. Docker's [download page](https://docs.docker.com/get-docker/) links to the full Windows guide.

**The bot doesn't start, and the log mentions "disallowed intents".** One of the two intents from step 4 is off. Turn on **Server Members Intent** and **Message Content Intent** on the Bot page, then run `docker compose restart`.

**Port 8080 is already in use.** Another program is using that port. Close it and run `docker compose up -d` again.

**Signing in fails.** The address under **Redirects** has to match your browser's address exactly. Check it against step 4 and make sure you clicked **Save Changes**.

**Your server isn't in the list.** You need Manage Server on it, and the bot has to be a member.

**The dashboard says the bot isn't responding.** Wait a minute and reload. If it still says that, run `docker compose logs bot` to see what the bot is reporting.

**`/ping` doesn't show up.** Commands appear a few seconds after you switch a feature on. Wait a bit, then reload Discord.

**You posted your token somewhere.** Go to the Bot page and click **Reset Token**. The old token stops working immediately.

The [quick install](install.md) has a longer troubleshooting table. If you're still stuck, open an issue on [GitHub](https://github.com/Luxrrrr/TierZero/issues) and say which step you're on. Include the error text, but not your token.

## Optional: let moderators use the dashboard from anywhere

Everything above works on the computer running TierZero. Other devices on your home network can also open the dashboard at that computer's address, such as `http://192.168.1.20:8080`, once you add that address under Redirects in the Developer Portal like the `localhost` one. It isn't encrypted, so keep it on your own network. If you're the only one who configures the bot, you can skip this section.

If you want moderators to use the moderation dashboard on their own devices, you have to make the dashboard reachable for them first. Adding them under **Moderation**, then **Access**, only says who is allowed in. It doesn't give them a way to get there. If you skip this section, your moderators can't use the dashboard, and they can still moderate in Discord as normal.

There are two ways to do it:

- **A Cloudflare Tunnel** gives the dashboard a normal web address, like `https://tierzero.yourdomain.com`, that anyone can open in a browser and sign in to with Discord. It needs a domain name, which costs money.
- **Tailscale** links your devices into a private network over the internet, wherever they are. Only devices running Tailscale can open the dashboard, so each moderator has to install the Tailscale app, and you share your computer with them. You then limit what they can reach so the dashboard is the only thing. It needs no domain and costs nothing for a few people.

If you want a website your moderators can open from any browser, use the tunnel. If it's a few people and you don't mind them installing an app, Tailscale is simpler. You only need one.

### Option A: Cloudflare Tunnel

A tunnel is a small program that runs next to TierZero and connects out to Cloudflare. Cloudflare then shows your dashboard at your web address and takes care of HTTPS. You don't change anything on your router and you don't expose your home network. The tunnel is free. You need two things first:

- **A domain name.** Something like `yourdomain.com`, bought from any domain registrar. It usually costs around ten dollars a year.
- **A free Cloudflare account**, with that domain added to it. Cloudflare walks you through this, and it involves changing the domain's nameservers at the registrar.

Then:

1. In the Cloudflare dashboard, go to **Zero Trust**, then **Networks**, then **Tunnels**, and create a tunnel. Name it anything. Cloudflare's menus change from time to time, so if something below has moved, their [tunnel guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the reference.
2. Cloudflare shows a command for installing the tunnel's connector. Pick your system, copy the command and run it in a terminal on the computer running TierZero. If you pick the Docker version, that works since you already have Docker.
3. Add a **public hostname**. Choose a subdomain, such as `tierzero`, and your domain. Set the service type to **HTTP** and the URL to `localhost:8080`. If you ran the Docker version of the connector, use `host.docker.internal:8080` instead, because `localhost` inside a Docker container means the container, not your computer.
4. Go back to the Discord Developer Portal, open your application, then **OAuth2**, and under **Redirects** add your new address with the ending shown here, using your own domain:

   ```
   https://tierzero.yourdomain.com/api/auth/callback/discord
   ```

   Click **Save Changes**. Keep the `localhost` one too.
5. Open `https://tierzero.yourdomain.com` in a browser. You should see the same dashboard. Sign in with Discord.

### Option B: Tailscale

Tailscale connects your devices into a private network, called a tailnet. The devices don't have to be on the same Wi-Fi. A phone on mobile data with Tailscale turned on can reach your home computer just like a laptop in the same room can. Nobody outside the tailnet can reach it.

**Read this before you start.** To let a moderator in, you *share* the computer running TierZero with them. Sharing gives them access to that one computer and nothing else in your Tailscale network. They can't see your other devices, and your computer can't start connections to theirs. But by default, Tailscale lets a person you share with reach everything running on that computer, which goes well beyond the dashboard. That includes things like Remote Desktop and file sharing. Step 4 adds a rule that limits them to the dashboard and nothing else. Don't skip it, and do it before you share.

If TierZero runs on its own computer, like a Raspberry Pi, this matters much less, because there's nothing else on it to reach.

1. Install [Tailscale](https://tailscale.com/download) on the computer running TierZero and sign in. You can use an account you already have, such as Google or Microsoft.
2. Find two things about that computer. Open the **Machines** page in the [Tailscale admin console](https://console.tailscale.com/admin/machines) and look at its row:
   - Its **full name**, which looks like `my-pc.tailnet-name.ts.net`.
   - Its **Tailscale IP**, which starts with `100.`, like `100.101.102.103`.

   Write both down. You'll use them below.
3. In the Discord Developer Portal, open your application, then **OAuth2**, and under **Redirects** add this, using your computer's full name:

   ```
   http://my-pc.tailnet-name.ts.net:8080/api/auth/callback/discord
   ```

   Click **Save Changes**. Discord rejects a short name like `my-pc` with "Not a well formed URL", because it wants a dot in the address.

   Now check it works. On a device of yours with Tailscale on, open `http://my-pc.tailnet-name.ts.net:8080` and sign in with Discord.
4. **Limit what shared people can reach.** In the Tailscale admin console, open the [Access controls](https://console.tailscale.com/admin/acls) page. You'll see a text box with settings. This is your tailnet's rulebook. Change it so it contains these rules. Replace `100.101.102.103` with your computer's Tailscale IP, and `you@example.com` with the email of your own Tailscale account:

   ```
   {
     "grants": [
       // Your own devices keep full access.
       { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },

       // People you share the TierZero computer with can reach port 8080 on it only.
       { "src": ["autogroup:shared"], "dst": ["100.101.102.103"], "ip": ["tcp:8080"] }
     ],

     "tests": [
       // Tailscale refuses to save the rules if this stops being true,
       // so a mistake can't cut you off from your own computer.
       { "src": "you@example.com", "proto": "tcp", "accept": ["100.101.102.103:3389"] }
     ]
   }
   ```

   If the box already has a short rule that starts with `"src": ["*"]`, replace it with the first rule above. If it has other things in it, like tags, subnet routes or SSH rules, keep those and ask Tailscale's help pages before changing them. Click **Save**. If Tailscale shows an error, read it and check that you replaced both placeholders. Port `3389` in the test is Remote Desktop. If you don't use it, put any port you do use on your computer.
5. **Share the computer with each moderator.** On the Machines page, click the menu (the three dots) on your TierZero computer, choose **Share**, then **Share by email**, and type their email address. Share by email, not by link, so you know exactly who has access. They accept the invite with their own Tailscale account. It doesn't have to use the same email you invited.
6. **Moderators join.** Each moderator installs Tailscale, signs in, accepts your invite, and opens `http://my-pc.tailnet-name.ts.net:8080` in their browser. For a shared computer, the full name is the only one that works. They sign in with Discord.

To remove someone's access later, go to the Machines page, open **Share** on your computer, and choose **Revoke invite** from the menu on their invite. They lose access straight away. To let them back in, you have to send a new invite and they have to accept it again.

On your own devices, the short name (`http://my-pc:8080`) also gets you to the dashboard. Signing in from it fails, so always open the full name when you sign in.

### Then add your moderators

Only people you add can use the moderation area. Open **Moderation** in the dashboard, go to **Access** and add each person. They sign in at the same address with their own Discord account. They only see the moderation area for servers where you've added them, and they don't need Manage Server.

If signing in or saving fails after this, the [quick install](install.md#reaching-the-dashboard-from-other-devices) explains the likely causes.

## Where to go next

[Features](features.md) describes each feature, including behavior that isn't obvious from the settings.
