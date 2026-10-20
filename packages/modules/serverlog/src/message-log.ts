import type { Message, PartialMessage } from "discord.js";
import { prisma } from "@tier0/db";
import type { Prisma } from "@tier0/db";
import { EVIDENCE_LIMITS, type DeletionSource, type EvidenceAttachment, type EvidenceMessage, type MessageVersion } from "@tier0/shared-moderation";
import { extrasOf } from "./extras.js";
import type { DeletionDecision } from "./deletion-source.js";
import { guarded, pruneIfDue } from "./record.js";
import type { ServerLogSettings } from "./settings.js";

/** What one logged message may grow to. Discord caps a message at 4000 characters; edits are what could be abused. */
export const LOG_LIMITS = { content: 4000, edits: 50, attachments: 10 } as const;

type LogSettings = ServerLogSettings;

function skipped(message: Message | PartialMessage, settings: LogSettings): boolean {
  if (!settings.categories.messages || !message.guildId) return true;
  const channel = message.channel;
  // A thread is left out when the channel it belongs to is.
  const parentId = "isThread" in channel && channel.isThread() ? channel.parentId : null;
  return settings.exclude.includes(message.channelId) || (parentId !== null && settings.exclude.includes(parentId));
}

const channelNameOf = (message: Message | PartialMessage): string => {
  const channel = message.channel;
  return "name" in channel && typeof channel.name === "string" ? channel.name : "";
};

const attachmentsOf = (message: Message | PartialMessage): EvidenceAttachment[] =>
  [...message.attachments.values()].slice(0, LOG_LIMITS.attachments).map((a) => ({
    name: a.name.slice(0, EVIDENCE_LIMITS.name),
    url: a.url,
    contentType: a.contentType,
  }));

const clipText = (text: string): string => text.slice(0, LOG_LIMITS.content);

export function logCreated(message: Message, settings: LogSettings): Promise<void> {
  if (skipped(message, settings) || !message.guildId) return Promise.resolve();
  const guildId = message.guildId;
  return guarded("save a message", async () => {
    await prisma.loggedMessage.upsert({
      where: { guildId_messageId: { guildId, messageId: message.id } },
      create: {
        guildId,
        messageId: message.id,
        channelId: message.channelId,
        channelName: channelNameOf(message),
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content: clipText(message.content),
        attachments: JSON.stringify(attachmentsOf(message)),
        extras: extrasOf(message),
        createdAt: new Date(message.createdTimestamp),
      },
      update: {},
    });
    await pruneIfDue(guildId, settings.days);
  });
}

/** What a saved edit looked like, so the server log can show it without asking the database again. */
export interface SavedEdit {
  before: string | null;
  after: string;
  authorId: string;
  authorName: string;
  channelName: string;
}

/**
 * Keeps what the message said before. A message from before the log was on has
 * no row yet, so the edit creates it, with the old text as its first version
 * when Discord still had it. Returns the edit that was saved, or null when
 * nothing changed or the message is not logged.
 */
export async function logEdited(before: Message | PartialMessage, after: Message | PartialMessage, settings: LogSettings): Promise<SavedEdit | null> {
  if (skipped(after, settings) || !after.guildId || after.content === null || after.author?.bot) return null;
  const guildId = after.guildId;
  const content = clipText(after.content);
  let saved: SavedEdit | null = null;
  await guarded("save an edit", async () => {
    const now = new Date();
    const row = await prisma.loggedMessage.findUnique({
      where: { guildId_messageId: { guildId, messageId: after.id } },
      select: { id: true, content: true, editedAt: true, createdAt: true, authorId: true, authorName: true, channelName: true, _count: { select: { edits: true } } },
    });

    if (row) {
      // Pins, embeds loading and the like also fire an update with the same text.
      if (row.content === content) return;
      await prisma.$transaction([
        ...(row._count.edits < LOG_LIMITS.edits
          ? [prisma.loggedMessageEdit.create({ data: { loggedId: row.id, content: row.content, at: row.editedAt ?? row.createdAt } })]
          : []),
        prisma.loggedMessage.update({ where: { id: row.id }, data: { content, editedAt: now } }),
      ]);
      saved = { before: row.content, after: content, authorId: row.authorId, authorName: row.authorName, channelName: row.channelName };
      return;
    }

    if (!after.author) return;
    const sent = new Date(after.createdTimestamp ?? now.getTime());
    const earlier = before.content !== null && before.content !== content ? clipText(before.content) : null;
    const authorName = after.member?.displayName ?? after.author.username;
    await prisma.loggedMessage.create({
      data: {
        guildId,
        messageId: after.id,
        channelId: after.channelId,
        channelName: channelNameOf(after),
        authorId: after.author.id,
        authorName,
        content,
        attachments: JSON.stringify(attachmentsOf(after)),
        extras: extrasOf(after),
        createdAt: sent,
        editedAt: now,
        ...(earlier !== null ? { edits: { create: { content: earlier, at: sent } } } : {}),
      },
    });
    saved = { before: earlier, after: content, authorId: after.author.id, authorName, channelName: channelNameOf(after) };
  });
  return saved;
}

/** What a deleted message said and who wrote it, for the server log. */
export interface SavedDeletion {
  content: string;
  authorId: string;
  authorName: string;
  channelName: string;
  attachments: EvidenceAttachment[];
  /** It was edited at least once before it was deleted. */
  edited: boolean;
  /** Who deleted it, when that could be told. */
  by: DeletionDecision | null;
}

/** Asked once for a message that is being marked deleted. Gets its author, or null when that is not known. */
export type WhoDeleted = (author: { id: string; name: string } | null) => Promise<DeletionDecision | null>;

/**
 * Marks the message deleted, with who deleted it when `whoDeleted` can say. One the log never saw is added
 * only if Discord still had its text. Returns what the message said, from the log or from Discord, or null
 * when nothing is known about it.
 */
export async function logDeleted(message: Message | PartialMessage, settings: LogSettings, whoDeleted?: WhoDeleted): Promise<SavedDeletion | null> {
  if (skipped(message, settings) || !message.guildId) return null;
  const guildId = message.guildId;
  let known: SavedDeletion | null = null;
  await guarded("mark a message deleted", async () => {
    const now = new Date();
    const row = await prisma.loggedMessage.findUnique({ where: { guildId_messageId: { guildId, messageId: message.id } } });
    if (row) {
      let by = storedDecision(row);
      if (row.deletedAt === null) {
        by = whoDeleted ? await whoDeleted({ id: row.authorId, name: row.authorName }) : null;
        await prisma.loggedMessage.update({ where: { id: row.id }, data: { deletedAt: now, ...deletedColumns(by) } });
      }
      known = {
        content: row.content,
        authorId: row.authorId,
        authorName: row.authorName,
        channelName: row.channelName,
        attachments: parseAttachments(row.attachments),
        edited: row.editedAt !== null,
        by,
      };
      return;
    }
    if (message.content === null || !message.author || message.author.bot) return;
    const authorName = message.author.username;
    const by = whoDeleted ? await whoDeleted({ id: message.author.id, name: authorName }) : null;
    const created = {
      guildId,
      messageId: message.id,
      channelId: message.channelId,
      channelName: channelNameOf(message),
      authorId: message.author.id,
      authorName,
      content: clipText(message.content),
      attachments: JSON.stringify(attachmentsOf(message)),
      extras: extrasOf(message),
      createdAt: new Date(message.createdTimestamp ?? now.getTime()),
      deletedAt: now,
      ...deletedColumns(by),
    };
    await prisma.loggedMessage.upsert({ where: { guildId_messageId: { guildId, messageId: message.id } }, create: created, update: {} });
    known = {
      content: created.content,
      authorId: created.authorId,
      authorName: created.authorName,
      channelName: created.channelName,
      attachments: attachmentsOf(message),
      edited: false,
      by,
    };
  });
  return known;
}

/** The columns that hold a deleter, empty when nobody could say. */
export function deletedColumns(by: DeletionDecision | null): { deletedBy: string | null; deletedById: string | null; deletedByName: string | null } {
  return { deletedBy: by?.by ?? null, deletedById: by?.byId ?? null, deletedByName: by?.byName ?? null };
}

const SOURCES = new Set(["author", "moderator", "automod", "bot"]);

/** The deleter for an evidence copy, left out when the row has none. */
export function deletedByOf(row: { deletedBy: string | null; deletedById: string | null; deletedByName: string | null }): { deletedBy?: DeletionSource; deletedByName?: string | null } {
  const by = storedDecision(row);
  return by ? { deletedBy: by.by, deletedByName: by.byName } : {};
}

/** The deleter a row already has, if it has one this version understands. */
export function storedDecision(row: { deletedBy: string | null; deletedById: string | null; deletedByName: string | null }): DeletionDecision | null {
  if (row.deletedBy === null || !SOURCES.has(row.deletedBy)) return null;
  return { by: row.deletedBy as DeletionDecision["by"], byId: row.deletedById, byName: row.deletedByName };
}

/** Deletes every logged message of a server, and returns how many there were. */
export async function purgeLog(guildId: string): Promise<number> {
  const { count } = await prisma.loggedMessage.deleteMany({ where: { guildId } });
  return count;
}

/** A logged message with its earlier versions. */
export type LoggedRow = Prisma.LoggedMessageGetPayload<{ include: { edits: true } }>;

/** Messages newest first, each with the text it had before edits. */
export function loadLogged(where: Prisma.LoggedMessageWhereInput, take: number, skip = 0): Promise<LoggedRow[]> {
  return prisma.loggedMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    skip,
    include: { edits: { orderBy: { at: "asc" } } },
  });
}

export function parseAttachments(stored: string): EvidenceAttachment[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((a): a is EvidenceAttachment => typeof a === "object" && a !== null && typeof (a as { url?: unknown }).url === "string")
      : [];
  } catch {
    return [];
  }
}

/** Every version, oldest first, the last being the current text. */
export function versionsOf(row: LoggedRow): MessageVersion[] {
  return [
    ...row.edits.map((edit) => ({ content: edit.content, at: edit.at.toISOString() })),
    { content: row.content, at: (row.editedAt ?? row.createdAt).toISOString() },
  ];
}

const clipEvidence = (text: string): string =>
  text.length > EVIDENCE_LIMITS.content ? `${text.slice(0, EVIDENCE_LIMITS.content - 1)}…` : text;

/** A logged message as a copy to keep with a case. */
export function evidenceFromLogged(row: LoggedRow, channelName: string, flagged?: number): EvidenceMessage {
  const versions = versionsOf(row);
  return {
    id: row.messageId,
    channelId: row.channelId,
    channelName: channelName || row.channelName,
    content: clipEvidence(row.content),
    attachments: parseAttachments(row.attachments).slice(0, EVIDENCE_LIMITS.attachments),
    createdAt: row.createdAt.toISOString(),
    url: `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`,
    deleted: row.deletedAt !== null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    ...deletedByOf(row),
    // Only an edited message has more than one. The latest is the default, so only another choice is recorded.
    ...(versions.length > 1
      ? {
          versions: versions.slice(-EVIDENCE_LIMITS.versions).map((v) => ({ content: clipEvidence(v.content), at: v.at })),
          ...(flagged !== undefined && flagged < versions.length - 1 ? { flagged } : {}),
        }
      : {}),
  };
}
