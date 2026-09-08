import type { Client } from "discord.js";

/**
 * Best-effort direct message. A member with DMs closed, or who has left
 * every server shared with the bot, makes this fail routinely - that must
 * never abort the action it is reporting on, so failures are swallowed here
 * rather than left for every call site to remember.
 */
export async function tryDirectMessage(
  client: Client,
  userId: string,
  content: string,
): Promise<boolean> {
  try {
    const user = await client.users.fetch(userId);
    await user.send(content);
    return true;
  } catch {
    return false;
  }
}
