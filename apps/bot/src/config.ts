function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail at startup with the variable name rather than several frames deep
    // inside discord.js with an opaque authentication error.
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  token: required("DISCORD_TOKEN"),
  applicationId: required("DISCORD_CLIENT_ID"),
  controlSecret: required("INTERNAL_API_SECRET"),
  controlPort: Number(process.env.CONTROL_PORT ?? 8081),
  // Defaults to loopback so running from source never exposes the control API
  // to the LAN. Set this only when the dashboard runs on another machine.
  controlHost: process.env.CONTROL_HOST ?? "127.0.0.1",
};
