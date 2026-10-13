import { PermissionFlagsBits, type Guild, type GuildMember, type Message } from "discord.js";
import { EVIDENCE_LIMITS, type EvidenceMessage, type EvidenceRef, type MessageVersion } from "@tier0/core";
import { ActionRefused } from "./action-rules.js";
import { LOG_LIMITS, deletedByOf, evidenceFromLogged, loadLogged, versionsOf, type LoggedRow } from "@tier0/module-serverlog";
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

/** The message that tripped an automod rule, as plain values so the copy can be built without discord.js. */
export interface TrippingMessage {
  id: string;
  channelId: string;
  channelName: string;
  content: string;
  attachments: readonly { name: string; url: string; contentType: string | null }[];
  createdAt: Date;
}

export interface TripEvidenceInput {
  guildId: string;
  message: TrippingMessage;
  /** The server log's copy of the message, when it has one. It may not have recorded this edit yet. */
  logged: LoggedRow | null;
  /** What the message said before the edit, when Discord still had it. */
  previousContent: string | null;
  /** The rule tripped on an edit rather than on the message as first sent. */
  isEdit: boolean;
  /** The message is gone, whether automod removed it or someone beat it to it. */
  deleted: boolean;
  now: Date;
}

/**
 * The copy automod keeps of a message that tripped a rule, in the shape a
 * moderator's attachment has, so the dashboard shows both the same way. When
 * the message was edited into breaking the rule, its earlier versions are kept
 * and the latest is flagged as the one that did. It is kept even when the
 * message could not be deleted.
 */
export function evidenceForTrip(input: TripEvidenceInput): EvidenceMessage {
  const { message, logged, now } = input;
  let versions: MessageVersion[] = [];
  if (logged) versions = versionsOf(logged);
  else if (input.isEdit && input.previousContent !== null && input.previousContent !== message.content) {
    versions = [{ content: input.previousContent.slice(0, LOG_LIMITS.content), at: message.createdAt.toISOString() }];
  }
  // The log keeps text clipped to its own limit, so compare like with like.
  const current = message.content.slice(0, LOG_LIMITS.content);
  if (versions.length > 0 && versions[versions.length - 1]?.content !== current) {
    versions = [...versions, { content: current, at: now.toISOString() }];
  }

  const kept = versions.slice(-EVIDENCE_LIMITS.versions).map((v) => ({ content: clip(v.content), at: v.at }));
  return {
    id: message.id,
    channelId: message.channelId,
    channelName: message.channelName || logged?.channelName || "",
    content: clip(message.content),
    attachments: trimAttachments(message.attachments),
    createdAt: message.createdAt.toISOString(),
    url: link(input.guildId, message.channelId, message.id),
    deleted: input.deleted,
    deletedAt: input.deleted ? (logged?.deletedAt ?? now).toISOString() : null,
    ...(input.deleted && logged ? deletedByOf(logged) : {}),
    ...(kept.length > 1 ? { versions: kept, ...(input.isEdit ? { flagged: kept.length - 1 } : {}) } : {}),
  };
}

/** The server log's row for a message, or null when there is none or the log cannot be read. */
export async function loggedCopyOf(guildId: string, messageId: string): Promise<LoggedRow | null> {
  try {
    const [row] = await loadLogged({ guildId, messageId }, 1);
    return row ?? null;
  } catch (error) {
    console.error("[automod] could not read the message log:", error);
    return null;
  }
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

    // The log has the whole history of a message, so it is asked first.
    const [logged] = await loadLogged({ guildId: guild.id, messageId: ref.messageId }, 1);
    if (logged) {
      if (logged.authorId !== targetId || logged.channelId !== ref.channelId) {
        throw new ActionRefused(400, "One of the messages wasn't sent by this member.");
      }
      if (ref.version !== undefined && ref.version >= logged.edits.length + 1) {
        throw new ActionRefused(400, "One of the messages doesn't have the version you chose. Reload the list and pick again.");
      }
      out.push(evidenceFromLogged(logged, channel.name, ref.version));
      continue;
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

const PICKER_SIZE = 50;

/**
 * What the picker shows: the member's latest messages the viewer can read, newest first. The log
 * is the main source, with its edits and deletions. The memory buffer adds what it holds that
 * the log does not, which is everything when the log is off.
 */
export async function recentFor(guild: Guild, userId: string, viewer: EvidenceViewer): Promise<EvidenceMessage[]> {
  const nameOf = (channelId: string, fallback: string) => guild.channels.cache.get(channelId)?.name ?? fallback;
  const logged = (await loadLogged({ guildId: guild.id, authorId: userId }, PICKER_SIZE))
    .filter((row) => viewerCanRead(guild, viewer, row.channelId))
    .map((row) => evidenceFromLogged(row, nameOf(row.channelId, row.channelName)));
  const known = new Set(logged.map((message) => message.id));
  const remembered = recentMessages
    .forMember(guild.id, userId)
    .filter((message) => !known.has(message.id) && viewerCanRead(guild, viewer, message.channelId))
    .map((message) => fromRemembered(guild.id, nameOf(message.channelId, message.channelName), message));
  return [...logged, ...remembered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PICKER_SIZE);
}
