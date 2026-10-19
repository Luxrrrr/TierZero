function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail at startup and name the missing variable. The alternative is an
    // opaque authentication error several frames deep inside discord.js.
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const controlSecret = required("INTERNAL_API_SECRET");
// Not a refusal, since an install with a short secret still works. A short one is guessable, and this is the
// only thing between the network the two containers share and the bot's control API.
if (controlSecret.length < 32) {
  console.warn("INTERNAL_API_SECRET is shorter than 32 characters. Set a long random one in .env, for example with: openssl rand -hex 32");
}

export const config = {
  token: required("DISCORD_TOKEN"),
  applicationId: required("DISCORD_CLIENT_ID"),
  controlSecret,
  controlPort: Number(process.env.CONTROL_PORT ?? 8081),
  // Defaults to loopback so running from source never exposes the control API
  // to the LAN. Set this only when the dashboard runs on another machine.
  controlHost: process.env.CONTROL_HOST ?? "127.0.0.1",
};
