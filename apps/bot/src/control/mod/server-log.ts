import { ChannelType } from "discord.js";
import { prisma } from "@tier0/db";
import {
  SERVER_LOG_CATEGORY_IDS,
  can,
  isServerLogCategory,
  readServerLogDetails,
  serverLogTypeLabel,
  type Actor,
  type LoggedMessageDto,
  type Page,
  type ServerLogEntryDto,
} from "@tier0/core";
import { fetchMemberOrNull, viewerCanRead } from "@tier0/module-moderation";
import { loadLogged, parseAttachments, purgeEntries, storedDecision, versionsOf, type LoggedRow, type ServerLogSettings } from "@tier0/module-serverlog";
import type { GuildState } from "../../runtime/guild-state.js";
import { writeAudit } from "./audit.js";
import { messageLogWhere } from "./message-filters.js";
import { refOf, resolveUsers } from "./names.js";
import { serverLogWhere } from "./server-log-filters.js";
import { forbidden, ok, pageOf, refuse, type ModCtx, type Reply } from "./types.js";

const MODULE_ID = "serverlog";

interface Access {
  settings: ServerLogSettings;
  /** The module is on and the kind of thing being read is switched on. */
  enabled: boolean;
  /** Channels the viewer can open, or null for someone who can see all of them. */
  readable: string[] | null;
  channels: { id: string; name: string }[];
}

/**
 * Who is asking and what they may see. The dashboard fills in `viewer`, `owner` and `role` from the
 * signed-in session, and the log only shows channels that person can read in Discord, so a moderator
 * without access to a private channel cannot read it here.
 */
async function accessFor(ctx: ModCtx, state: GuildState, query: URLSearchParams): Promise<Access | Reply> {
  const moduleCtx = await state.context(ctx.guild, MODULE_ID);
  if (!moduleCtx) return refuse(409, "The Server logs settings could not be read. Open them in the dashboard and save them again.");
  const settings = moduleCtx.settings as ServerLogSettings;
  const enabled = await state.isEnabled(ctx.guild.id, MODULE_ID);

  const isOwner = query.get("owner") === "1";
  if (query.get("role") === "mod" && !isOwner && !settings.modsCanView) {
    return forbidden("open the server logs. An admin can turn this on for moderators in the Server logs settings");
  }

  const viewerId = query.get("viewer");
  const member = viewerId ? await fetchMemberOrNull(ctx.guild, viewerId) : null;
  const viewer = { member, isOwner };
  const channels = [...ctx.guild.channels.cache.values()]
    .filter(
      (c) =>
        (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement || c.type === ChannelType.GuildVoice) &&
        viewerCanRead(ctx.guild, viewer, c.id),
    )
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { settings, enabled, readable: isOwner ? null : channels.map((c) => c.id), channels };
}

const isReply = (value: Access | Reply): value is Reply => "status" in value;

export interface ServerLogPage extends Page<ServerLogEntryDto> {
  logEnabled: boolean;
  days: number;
  /** Which kinds of event are being saved, so the page can say what is off. */
  recording: Record<string, boolean>;
  channels: { id: string; name: string }[];
  /** Entries for each category under every other filter, to label the category chips. */
  counts: Record<string, number>;
}

/** GET /mod/server-logs?q=&category=&type=&member=&channel=&since=&until=&page= */
export async function listServerLog(ctx: ModCtx, state: GuildState, query: URLSearchParams): Promise<Reply> {
  const access = await accessFor(ctx, state, query);
  if (isReply(access)) return access;

  const { page, pageSize } = pageOf(query);
  const where = serverLogWhere(ctx.guild.id, query, access.readable);
  const [total, rows, grouped] = await Promise.all([
    prisma.serverLogEntry.count({ where }),
    prisma.serverLogEntry.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.serverLogEntry.groupBy({ by: ["category"], where: serverLogWhere(ctx.guild.id, query, access.readable, false), _count: { _all: true } }),
  ]);

  const ids = rows.flatMap((row) => [row.actorId, row.targetId].filter((id): id is string => id !== null));
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  const items: ServerLogEntryDto[] = rows.map((row) => {
    const named = (id: string | null, saved: string) => {
      if (id === null) return null;
      const ref = refOf(refs, id);
      // The name saved with the entry still reads right after the member leaves or renames themselves.
      return ref.name === null && saved ? { ...ref, name: saved } : ref;
    };
    return {
      id: row.id,
      at: row.at.toISOString(),
      type: row.type,
      category: (isServerLogCategory(row.category) ? row.category : "server") as ServerLogEntryDto["category"],
      label: serverLogTypeLabel(row.type),
      summary: row.summary,
      actor: named(row.actorId, row.actorName),
      target: named(row.targetId, row.targetName),
      channel: row.channelId ? { id: row.channelId, name: ctx.guild.channels.cache.get(row.channelId)?.name ?? row.channelName } : null,
      details: readServerLogDetails(row.details),
    };
  });

  // Whether a deleted message had been edited is read from the saved message itself, so entries written
  // before that was recorded on the entry still know.
  const unknown = items.filter((item) => item.type === "message.delete" && item.details.edited === undefined && item.details.messageId);
  if (unknown.length > 0) {
    const edited = await prisma.loggedMessage.findMany({
      where: { guildId: ctx.guild.id, messageId: { in: unknown.map((item) => item.details.messageId!) }, editedAt: { not: null } },
      select: { messageId: true },
    });
    const ids = new Set(edited.map((row) => row.messageId));
    for (const item of unknown) item.details.edited = ids.has(item.details.messageId!);
  }

  const counts: Record<string, number> = {};
  for (const id of SERVER_LOG_CATEGORY_IDS) counts[id] = 0;
  for (const group of grouped) counts[group.category] = group._count._all;

  const body: ServerLogPage = {
    items,
    total,
    page,
    pageSize,
    logEnabled: access.enabled,
    days: access.settings.days,
    recording: { ...access.settings.categories },
    channels: access.channels,
    counts,
  };
  return ok(body);
}

/** What the Messages view needs besides the rows. */
export interface MessageLogPage extends Page<LoggedMessageDto> {
  logEnabled: boolean;
  days: number;
  channels: { id: string; name: string }[];
}

/** GET /mod/messages?q=&author=&channel=&since=&until=&state=&message=&page= */
export async function listLoggedMessages(ctx: ModCtx, state: GuildState, query: URLSearchParams): Promise<Reply> {
  const access = await accessFor(ctx, state, query);
  if (isReply(access)) return access;

  const { page, pageSize } = pageOf(query);
  const where = messageLogWhere(ctx.guild.id, query, access.readable);
  const [total, rows] = await Promise.all([prisma.loggedMessage.count({ where }), loadLogged(where, pageSize, (page - 1) * pageSize)]);

  const refs = await resolveUsers(ctx.client, ctx.guild, rows.map((row) => row.authorId));
  const body: MessageLogPage = {
    items: rows.map((row) => toMessageDto(row, ctx.guild.id, refs, ctx.guild.channels.cache.get(row.channelId)?.name)),
    total,
    page,
    pageSize,
    logEnabled: access.enabled && access.settings.categories.messages,
    days: access.settings.days,
    channels: access.channels,
  };
  return ok(body);
}

function toMessageDto(row: LoggedRow, guildId: string, refs: Awaited<ReturnType<typeof resolveUsers>>, channelName: string | undefined): LoggedMessageDto {
  const author = refOf(refs, row.authorId);
  return {
    id: row.messageId,
    channelId: row.channelId,
    channelName: channelName ?? row.channelName,
    author: author.name === null ? { ...author, name: row.authorName || null } : author,
    content: row.content,
    attachments: parseAttachments(row.attachments),
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: storedDecision(row)?.by ?? null,
    deletedByName: storedDecision(row)?.byName ?? null,
    extras: row.extras,
    versions: versionsOf(row),
    url: `https://discord.com/channels/${guildId}/${row.channelId}/${row.messageId}`,
  };
}

/** DELETE /mod/server-logs -> removes every entry and every saved message of the server. */
export async function purgeServerLog(ctx: ModCtx, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "messages.purge")) return forbidden("delete the server logs");
  const { entries, messages } = await purgeEntries(ctx.guild.id);
  await writeAudit({
    guildId: ctx.guild.id,
    actor,
    kind: "messagelog.purge",
    summary: `Deleted the server logs (${entries} ${entries === 1 ? "entry" : "entries"} and ${messages} saved ${messages === 1 ? "message" : "messages"})`,
  });
  return ok({ deleted: entries + messages });
}
