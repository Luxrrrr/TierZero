import { PermissionFlagsBits, type Guild } from "discord.js";
import { DELETE_MESSAGES_LIMIT, noteDeletion, takeDeletionNote, type EvidenceMessage } from "@tier0/core";
import { describeDiscordError } from "./action-rules.js";

/** Discord's code for a message that no longer exists. */
const UNKNOWN_MESSAGE = 10008;

export interface DeletionFailure {
  id: string;
  channelName: string;
  /** Worded for the person who acted. */
  reason: string;
}

export interface DeletionReport {
  /** Ids of the messages the bot deleted just now. */
  deleted: string[];
  /** Ids of messages that were already gone when the bot tried. */
  alreadyGone: string[];
  failed: DeletionFailure[];
  /** Attached messages left alone because the cap was reached. */
  beyondLimit: number;
}

export interface DeletionActor {
  id: string;
  name?: string;
}

/** Whether the bot may delete this message now: its channel is in the server and the bot can manage messages there. */
export function botMayDelete(guild: Guild, message: Pick<EvidenceMessage, "channelId" | "deleted">): boolean {
  if (message.deleted) return false;
  const channel = guild.channels.cache.get(message.channelId);
  const me = guild.members.me;
  if (!channel || !me || !channel.isTextBased() || channel.isDMBased()) return false;
  return channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages]) === true;
}

/**
 * Deletes the messages that were attached to an action, and only those. The
 * copies were already checked when they were attached, so each is by the member
 * acted on and in a channel of this server; this adds the bot's own permission
 * to delete in that channel. A message that is already gone counts as done, and
 * one Discord refuses is reported without stopping the rest.
 *
 * Each deletion is announced to the server log first, because the deletion event
 * can reach it before the call returns, and that is how the log says a moderator
 * removed the message rather than leaving the source unknown.
 */
export async function deleteAttachedMessages(
  guild: Guild,
  attached: readonly EvidenceMessage[],
  by: DeletionActor,
): Promise<DeletionReport> {
  const report: DeletionReport = { deleted: [], alreadyGone: [], failed: [], beyondLimit: 0 };
  const targets = attached.filter((message) => !message.deleted);
  report.beyondLimit = Math.max(0, targets.length - DELETE_MESSAGES_LIMIT);
  const me = guild.members.me;

  for (const message of targets.slice(0, DELETE_MESSAGES_LIMIT)) {
    const channel = guild.channels.cache.get(message.channelId);
    const name = channel && "name" in channel ? channel.name : message.channelName;
    const fail = (reason: string) => report.failed.push({ id: message.id, channelName: name, reason });

    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      fail("the channel is no longer in this server");
      continue;
    }
    if (!me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages])) {
      fail("the bot does not have the Manage Messages permission there");
      continue;
    }

    noteDeletion(message.id, { by: "moderator", byId: by.id, ...(by.name ? { byName: by.name } : {}) });
    try {
      await channel.messages.delete(message.id);
      report.deleted.push(message.id);
    } catch (error) {
      // Nothing was deleted by this call, so the note must not be claimed by a later deletion.
      takeDeletionNote(message.id);
      if ((error as { code?: unknown } | null)?.code === UNKNOWN_MESSAGE) {
        report.alreadyGone.push(message.id);
        continue;
      }
      console.warn(`moderation: could not delete message ${message.id} in guild ${guild.id}: ${describeDiscordError(error)}`);
      fail("Discord refused");
    }
  }
  return report;
}

/**
 * The copies with the ones this action deleted marked, content kept, so staff
 * can still read what was said. A message that was already gone is marked as
 * deleted but not as deleted by the action.
 */
export function markDeleted(
  evidence: readonly EvidenceMessage[],
  report: Pick<DeletionReport, "deleted" | "alreadyGone">,
  by: DeletionActor,
  now: Date = new Date(),
): EvidenceMessage[] {
  return evidence.map((message) => {
    if (report.deleted.includes(message.id)) {
      return {
        ...message,
        deleted: true,
        deletedAt: now.toISOString(),
        deletedBy: "moderator",
        deletedByName: by.name ?? null,
        deletedWithAction: true,
      };
    }
    if (report.alreadyGone.includes(message.id)) return { ...message, deleted: true, deletedAt: message.deletedAt ?? now.toISOString() };
    return { ...message };
  });
}

const plural = (count: number): string => (count === 1 ? "1 message" : `${count} messages`);

/** What to tell the moderator about the deletion, in the dashboard's plain wording. Empty when nothing was asked or nothing needs saying. */
export function deletionNotes(report: DeletionReport): string[] {
  const notes: string[] = [];
  if (report.deleted.length > 0) notes.push(`Deleted ${plural(report.deleted.length)}.`);
  if (report.failed.length > 0) {
    const channels = [...new Set(report.failed.map((failure) => `#${failure.channelName}`))].join(", ");
    const missing = report.failed.some((failure) => failure.reason.includes("Manage Messages"));
    notes.push(
      `The action went through, but ${plural(report.failed.length)} could not be deleted (${channels}). ${
        missing ? "Give the bot the Manage Messages permission in that channel, or delete them by hand." : "Delete them by hand if they should go."
      }`,
    );
  }
  if (report.beyondLimit > 0) notes.push(`Only the first ${DELETE_MESSAGES_LIMIT} messages are deleted at once, so ${plural(report.beyondLimit)} ${report.beyondLimit === 1 ? "was" : "were"} left.`);
  return notes;
}
