# Security

## Reporting a problem

If you find a security problem in TierZero, please report it privately and not in a public issue. Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**.

Say what you found, how to reproduce it, and which version you were running. You can expect an answer within a few days. A fix is released as soon as it's ready, and the release notes say what was fixed once people have had a chance to update.

## What is covered

The dashboard, the bot, the control API between them and the Docker setup in this repository. A problem in Discord itself, or in a service you put in front of TierZero such as a reverse proxy, belongs with whoever runs that.

## Running it safely

- Keep `.env` private. It holds the bot token and the secrets that protect the dashboard.
- Don't publish the control API's port. The Compose file doesn't, and only the dashboard needs to reach it.
- If the machine is reachable from the internet, set `DASHBOARD_BIND=127.0.0.1` and put a Cloudflare Tunnel or an HTTPS proxy in front. [The install guide](docs/install.md#running-it-on-a-server) has the steps.
- Update when a release says it fixes a security problem.
