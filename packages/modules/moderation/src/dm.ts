import type { Client } from "discord.js";

/**
 * Best-effort direct message. A member with DMs closed, or who has left
 * every server shared with the bot, makes this fail routinely - that must
 * never abort the action it is reporting on. Failures are swallowed here so
 * no call site has to remember to do it itself.
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
