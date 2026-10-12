// The permissions the bot needs for every feature. Documented alongside the same
// number in docs/install.md; changing one means changing both.
export const INVITE_PERMISSIONS = "1391837965526";

/** The link that adds the bot to a server, or null while DISCORD_CLIENT_ID is unset. */
export function inviteUrl(): string | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
}
