import type { Guild, InteractionReplyOptions } from "discord.js";
import { applyVariablesToMessage, parseMessage, plainReply, type MessageBody } from "@tier0/core";
import { namesOf, toDiscordPayload } from "../control/message-payload.js";

/**
 * The reply an owner wrote for a command, read back through the same rules a
 * save goes through. A row from before replies were whole messages holds only
 * text, and is read as a message that is just that text. A value that no longer
 * passes reads as no reply, so the command says what it always says rather than
 * sending something Discord would refuse.
 */
export function storedReply(row: { responseBody: string | null; response: string | null } | null): MessageBody | null {
  if (!row) return null;
  if (row.responseBody !== null) {
    try {
      const parsed = parseMessage(JSON.parse(row.responseBody) as unknown);
      return parsed.ok ? parsed.value : null;
    } catch {
      return null;
    }
  }
  if (row.response !== null && row.response.trim() !== "") return plainReply(row.response);
  return null;
}

/**
 * Fills in a stored reply and turns it into what discord.js sends. Returns null
 * when filling it in made it too long or otherwise invalid, which the caller
 * treats as "use the default". Only people and roles can be pinged from it.
 */
export function buildReply(message: MessageBody, values: Record<string, string>, guild?: Guild): InteractionReplyOptions | null {
  const filled = parseMessage(applyVariablesToMessage(message, values));
  if (!filled.ok) {
    console.error("A command reply no longer fits Discord's limits once its variables are filled in:", filled.errors[0]?.message);
    return null;
  }
  return { ...toDiscordPayload(filled.value, guild ? namesOf(guild) : undefined), allowedMentions: { parse: ["users", "roles"] } };
}
