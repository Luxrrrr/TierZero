import type { Client } from "discord.js";
import { evidenceRefFromLink, type EvidenceRef } from "@tier0/shared-moderation";
import { prisma } from "@tier0/db";
import { copyOfFetched } from "./evidence.js";

const LINE = /^Message: (\S+)$/;

/**
 * Cases made from a right-click before messages could be attached carry the
 * message as a "Message: <link>" line in the reason. Splits that line off so
 * the message can be attached properly.
 */
export function splitMessageLink(reason: string | null): { ref: EvidenceRef; rest: string | null } | null {
  if (!reason) return null;
  const lines = reason.split("\n");
  const index = lines.findIndex((line) => LINE.test(line.trim()));
  if (index < 0) return null;
  const ref = evidenceRefFromLink(LINE.exec(lines[index]!.trim())![1]!);
  if (!ref) return null;
  lines.splice(index, 1);
  return { ref, rest: lines.join("\n").trim() || null };
}

/**
 * Turns the old link-only cases into cases with the message attached, for as
 * long as the message still exists. Safe to run on every start: a case that
 * already has messages, or whose message is gone, is left as it was.
 */
export async function backfillEvidence(client: Client): Promise<number> {
  const rows = await prisma.infraction.findMany({
    where: { evidence: "[]", reason: { contains: "Message: https://" } },
    select: { id: true, guildId: true, userId: true, reason: true },
  });
  let updated = 0;
  for (const row of rows) {
    const split = splitMessageLink(row.reason);
    if (!split) continue;
    const guild = client.guilds.cache.get(row.guildId);
    const channel = guild?.channels.cache.get(split.ref.channelId);
    if (!guild || !channel || !channel.isTextBased() || channel.isDMBased()) continue;
    const message = await channel.messages.fetch(split.ref.messageId).catch(() => null);
    if (!message || message.author.id !== row.userId) continue;
    await prisma.infraction.update({
      where: { id: row.id },
      data: { evidence: JSON.stringify([copyOfFetched(guild.id, channel.name, message)]), reason: split.rest },
    });
    updated += 1;
  }
  return updated;
}
