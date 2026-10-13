import { AuditLogEvent, type Guild } from "discord.js";
import { prisma } from "@tier0/db";
import { serverLogCategoryOf, type ServerLogDetails } from "@tier0/core";
import type { AuditCandidate } from "./deletion-source.js";
import type { ServerLogSettings } from "./settings.js";

/** Longest a summary or a before/after value is kept, so one huge message or topic cannot bloat the log. */
export const ENTRY_LIMITS = { summary: 300, value: 1500, notes: 12, changes: 20, pruneEveryMs: 60 * 60 * 1000 } as const;

const lastPrune = new Map<string, number>();

/** Logging must never take the gateway handler down, so a failed write is reported and dropped. */
export async function guarded(what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`Server log: could not ${what}`, error);
  }
}

export const clip = (text: string, max: number = ENTRY_LIMITS.value): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export interface Who {
  id: string;
  name: string;
}

export interface EntryInput {
  type: string;
  summary: string;
  actor?: Who | null;
  target?: Who | null;
  channel?: Who | null;
  details?: ServerLogDetails;
}

/** Whether this kind of event is switched on, and the channel it happened in is not left out. */
export function wanted(settings: ServerLogSettings, type: string, channelIds: readonly (string | null | undefined)[] = []): boolean {
  const category = serverLogCategoryOf(type);
  if (!category || !settings.categories[category]) return false;
  return !channelIds.some((id) => id && settings.exclude.includes(id));
}

/** Deletes what is older than the server's limit, at most once an hour for each server. */
export async function pruneIfDue(guildId: string, days: number): Promise<void> {
  const now = Date.now();
  if (now - (lastPrune.get(guildId) ?? 0) < ENTRY_LIMITS.pruneEveryMs) return;
  lastPrune.set(guildId, now);
  const before = new Date(now - days * 86_400_000);
  await prisma.loggedMessage.deleteMany({ where: { guildId, createdAt: { lt: before } } });
  await prisma.serverLogEntry.deleteMany({ where: { guildId, at: { lt: before } } });
}

/** Saves one entry, if that kind of event is on. */
export function record(guild: Guild, settings: ServerLogSettings, input: EntryInput): Promise<void> {
  if (!wanted(settings, input.type, [input.channel?.id])) return Promise.resolve();
  return guarded(`save a ${input.type} entry`, async () => {
    const details: ServerLogDetails = { ...input.details };
    if (details.changes) {
      details.changes = details.changes
        .slice(0, ENTRY_LIMITS.changes)
        .map((c) => ({ label: c.label, before: c.before === null ? null : clip(c.before), after: c.after === null ? null : clip(c.after) }));
    }
    if (details.notes) details.notes = details.notes.slice(0, ENTRY_LIMITS.notes).map((n) => clip(n, 300));
    await prisma.serverLogEntry.create({
      data: {
        guildId: guild.id,
        type: input.type,
        category: serverLogCategoryOf(input.type) ?? "server",
        actorId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? "",
        targetId: input.target?.id ?? null,
        targetName: input.target?.name ?? "",
        channelId: input.channel?.id ?? null,
        channelName: input.channel?.name ?? "",
        summary: clip(input.summary, ENTRY_LIMITS.summary),
        details: JSON.stringify(details),
      },
    });
    await pruneIfDue(guild.id, settings.days);
  });
}

/** Deletes every entry and every saved message of a server. Returns how many of each there were. */
export async function purgeEntries(guildId: string): Promise<{ entries: number; messages: number }> {
  const entries = await prisma.serverLogEntry.deleteMany({ where: { guildId } });
  const messages = await prisma.loggedMessage.deleteMany({ where: { guildId } });
  return { entries: entries.count, messages: messages.count };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Who Discord says did something, read from the server's own audit log. That needs the View Audit Log
 * permission, and Discord writes the line a moment after the event, so this waits briefly first. When the
 * permission is missing or no line matches, the answer is null and the entry simply has no actor.
 */
export async function executorOf(guild: Guild, type: AuditLogEvent, targetId: string, withinMs = 15_000): Promise<Who | null> {
  try {
    await sleep(700);
    const logs = await guild.fetchAuditLogs({ type, limit: 8 });
    const found = logs.entries.find((entry) => entry.targetId === targetId && Date.now() - entry.createdTimestamp < withinMs);
    if (!found?.executor) return null;
    return { id: found.executor.id, name: found.executor.displayName ?? found.executor.username };
  } catch {
    return null;
  }
}

/**
 * The server's recent message deletions, from its audit log, for working out who deleted a message.
 * Without the View Audit Log permission, or when Discord fails, the answer is an empty list: the caller
 * then falls back to the author, as Discord records nothing for someone deleting their own message.
 */
export async function recentMessageDeletions(guild: Guild): Promise<AuditCandidate[]> {
  try {
    await sleep(700);
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 });
    const now = Date.now();
    return [...logs.entries.values()].flatMap((entry) => {
      if (!entry.executor) return [];
      const extra = entry.extra as { channel?: { id?: string } | null; count?: number } | null;
      return [
        {
          id: entry.id,
          executorId: entry.executor.id,
          executorName: guild.members.cache.get(entry.executor.id)?.displayName ?? entry.executor.displayName ?? entry.executor.username,
          targetId: entry.targetId,
          channelId: extra?.channel?.id ?? null,
          count: typeof extra?.count === "number" ? extra.count : 1,
          ageMs: now - entry.createdTimestamp,
        },
      ];
    });
  } catch {
    return [];
  }
}

export { AuditLogEvent };
