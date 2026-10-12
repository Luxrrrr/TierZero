import { PermissionFlagsBits, type Guild, type GuildMember, type Message } from "discord.js";
import { EVIDENCE_LIMITS, type EvidenceMessage, type EvidenceRef } from "@tier0/core";
import { ActionRefused } from "./action-rules.js";
import { recentMessages, type RecentMessage } from "./recent-messages.js";

/** Who is attaching, which decides which channels' messages they may see. */
export interface EvidenceViewer {
  /** The person as a member of this server, or null when they are not one. */
  member: GuildMember | null;
  /** The person running the install, who can read what the bot can. */
  isOwner: boolean;
}

/**
 * Whether the viewer could read this channel in Discord. A moderator who cannot
 * open a channel must not be able to read it through the dashboard, so the same
 * test applies to the list of a member's messages and to a pasted link.
 */
export function viewerCanRead(guild: Guild, viewer: EvidenceViewer, channelId: string): boolean {
  if (viewer.isOwner) return true;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !viewer.member) return false;
  return channel.permissionsFor(viewer.member)?.has(PermissionFlagsBits.ViewChannel) === true;
}

const clip = (text: string): string =>
  text.length > EVIDENCE_LIMITS.content ? `${text.slice(0, EVIDENCE_LIMITS.content - 1)}…` : text;

const link = (guildId: string, channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

const trimAttachments = (list: readonly { name: string; url: string; contentType: string | null }[]) =>
  list.slice(0, EVIDENCE_LIMITS.attachments).map((a) => ({ name: a.name.slice(0, EVIDENCE_LIMITS.name), url: a.url, contentType: a.contentType }));

function fromRemembered(guildId: string, channelName: string, message: RecentMessage): EvidenceMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    channelName,
    content: clip(message.content),
    attachments: trimAttachments(message.attachments),
    createdAt: new Date(message.createdAt).toISOString(),
    url: link(guildId, message.channelId, message.id),
    deleted: message.deleted,
  };
}

export function copyOfFetched(guildId: string, channelName: string, message: Message): EvidenceMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    channelName,
    content: clip(message.content),
    attachments: trimAttachments([...message.attachments.values()].map((a) => ({ name: a.name, url: a.url, contentType: a.contentType }))),
    createdAt: new Date(message.createdTimestamp).toISOString(),
    url: link(guildId, message.channelId, message.id),
    deleted: false,
  };
}

/**
 * Turns the messages a moderator picked into copies to keep with the action.
 * Each must be by the member being acted on, and in a channel the moderator can
 * read. A message the bot saw is taken from memory, which still has it if it was
 * since deleted; anything else is fetched from Discord. This has to run before
 * the action does, because a ban can delete the member's recent messages.
 */
export async function resolveEvidence(
  guild: Guild,
  targetId: string,
  refs: readonly EvidenceRef[],
  viewer: EvidenceViewer,
): Promise<EvidenceMessage[]> {
  const out: EvidenceMessage[] = [];
  for (const ref of refs) {
    const channel = guild.channels.cache.get(ref.channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new ActionRefused(400, "One of the messages is in a channel this server doesn't have.");
    }
    if (!viewerCanRead(guild, viewer, ref.channelId)) {
      throw new ActionRefused(403, `You can't attach messages from #${channel.name}, because you can't read that channel.`);
    }

    const remembered = recentMessages.find(ref.messageId);
    if (remembered) {
      if (remembered.authorId !== targetId || remembered.channelId !== ref.channelId) {
        throw new ActionRefused(400, "One of the messages wasn't sent by this member.");
      }
      out.push(fromRemembered(guild.id, channel.name, remembered));
      continue;
    }

    const fetched = await channel.messages.fetch(ref.messageId).catch(() => null);
    if (!fetched) {
      throw new ActionRefused(404, `One of the messages couldn't be found in #${channel.name}. It may have been deleted.`);
    }
    if (fetched.author.id !== targetId) throw new ActionRefused(400, "One of the messages wasn't sent by this member.");
    out.push(copyOfFetched(guild.id, channel.name, fetched));
  }
  return out;
}

/** What the picker shows: the member's remembered messages the viewer can read, newest first. */
export function recentFor(guild: Guild, userId: string, viewer: EvidenceViewer): EvidenceMessage[] {
  return recentMessages
    .forMember(guild.id, userId)
    .filter((message) => viewerCanRead(guild, viewer, message.channelId))
    .map((message) => fromRemembered(guild.id, guild.channels.cache.get(message.channelId)?.name ?? message.channelName, message));
}
