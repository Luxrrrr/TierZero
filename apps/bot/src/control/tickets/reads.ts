import { PermissionFlagsBits } from "discord.js";
import { prisma, type Ticket } from "@tier0/db";
import {
  readTicketAnswers,
  TICKET_PAGE_SIZE,
  TICKET_PRIORITIES,
  TICKET_REPLY_FILES_BYTES_MAX,
  TICKET_REPLY_FILES_MAX,
  TICKET_STATS_PERIODS,
  ticketHealth,
  ticketHealthSummary,
  ticketPermissions,
  type TicketContextDto,
  type TicketCountDto,
  type TicketHealthIssue,
  type TicketHealthSummary,
  type TicketListFilters,
  type TicketPage,
  type TicketPanelOption,
  type TicketStatsDto,
  type TicketTemplateDto,
  type TicketTemplatesDto,
} from "@tier0/core";
import { storedBody } from "../messages.js";
import { searchGuildMemberPage } from "../mod/members.js";
import { refOf, resolveUsers } from "../mod/names.js";
import { awaitingStaffFor } from "./detail.js";
import { summaryDto } from "./dto.js";
import { listOrder, listWhere, viewerScope } from "./query.js";
import { allTypes, priorityLabel, renderStoredTranscriptText, renderTranscriptHtml, ticketNumber, transcriptTexts } from "./runtime.js";
import { computeTicketStats } from "./stats-calc.js";
import { fail, ok, type Reply, type TicketEnv } from "./types.js";

/** Most names a list page looks up from Discord. The rest show the name stored on the ticket. */
const LIST_NAME_FETCHES = 30;

export async function listTickets(env: TicketEnv, filters: TicketListFilters): Promise<Reply> {
  const where = listWhere(env.guild.id, filters, env.access);
  if (where === null) return fail(403, "You cannot see this server's tickets.");
  const skip = (filters.page - 1) * TICKET_PAGE_SIZE;
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, orderBy: listOrder(filters.sort), skip, take: TICKET_PAGE_SIZE }),
  ]);
  const botId = env.client.user?.id ?? null;
  const [awaiting, refs] = await Promise.all([
    awaitingStaffFor(rows, botId),
    resolveUsers(env.client, env.guild, rows.flatMap((row) => [row.openerId, ...(row.claimedById ? [row.claimedById] : [])]), {
      maxFetches: LIST_NAME_FETCHES,
    }),
  ]);
  const body: TicketPage = {
    items: rows.map((row) => summaryDto(row, refs, awaiting.has(row.id))),
    total,
    page: filters.page,
    pageSize: TICKET_PAGE_SIZE,
  };
  return ok(body);
}

/**
 * `GET count`: how many tickets the list's filters match, how many of them
 * opened after `after`, and the newest id and activity among them. Three
 * small queries and no names, so a list can ask every few seconds.
 */
export async function countTickets(env: TicketEnv, filters: TicketListFilters, version?: number): Promise<Reply> {
  const all = listWhere(env.guild.id, { ...filters, afterId: null }, env.access);
  if (all === null) return fail(403, "You cannot see this server's tickets.");
  const after = filters.afterId ? { AND: [all, { id: { gt: filters.afterId } }] } : all;
  const [total, newCount, latest, open] = await Promise.all([
    prisma.ticket.count({ where: all }),
    filters.afterId ? prisma.ticket.count({ where: after }) : Promise.resolve(null),
    prisma.ticket.aggregate({ where: all, _max: { id: true, lastActivityAt: true } }),
    prisma.ticket.findMany({ where: { AND: [all, { status: "open" }] }, select: { id: true, openerId: true }, take: COUNT_AWAITING_MAX }),
  ]);
  const awaiting = await awaitingStaffFor(open, env.client.user?.id ?? null);
  const body: TicketCountDto = {
    total,
    newCount: newCount ?? total,
    latestId: latest._max.id ?? null,
    latestActivityAt: latest._max.lastActivityAt?.toISOString() ?? null,
    awaitingStaff: awaiting.size,
    ...(version !== undefined ? { version } : {}),
  };
  return ok(body);
}

/** Open tickets the count looks at to say how many wait on staff. More than this is still counted as this many. */
const COUNT_AWAITING_MAX = 500;
const MEMBER_IDS_MAX = 50;

/**
 * `GET members?q=` finds members by name for the Add member form and the
 * blocklist, the same way Moderation's search does. `GET members?ids=` names
 * members already known by id, such as the blocked ones.
 */
export async function findMembers(env: TicketEnv, query: URLSearchParams): Promise<Reply> {
  const ids = (query.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{17,20}$/.test(id))
    .slice(0, MEMBER_IDS_MAX);
  if (ids.length > 0) {
    const refs = await resolveUsers(env.client, env.guild, ids, { maxFetches: 25 });
    return ok(ids.map((id) => ({ user: refOf(refs, id) })));
  }
  const q = (query.get("q") ?? "").trim().slice(0, 100);
  return searchGuildMemberPage({ client: env.client, guild: env.guild }, q);
}

export async function ticketsAccess(env: TicketEnv): Promise<Reply> {
  return ok({
    level: env.access.level,
    handledTypeIds: env.access.handledTypeIds,
    permissions: ticketPermissions(env.access),
    moduleEnabled: env.enabled,
  });
}

export async function ticketsContext(env: TicketEnv): Promise<Reply> {
  const { ctx, access, guild, services } = env;
  const handled = new Set(access.handledTypeIds);

  let health: TicketHealthIssue[] = [];
  let healthSummary: TicketHealthSummary | undefined;
  try {
    const facts = await services.ticketHealthFacts(ctx);
    health = ticketHealth(facts);
    healthSummary = ticketHealthSummary(facts, health);
  } catch (error) {
    console.error(`tickets: could not check the setup of guild ${guild.id}:`, error);
  }
  const blocked = new Map((healthSummary?.blockedTypes ?? []).map((entry) => [`${entry.panelId}:${entry.typeId}`, entry.codes]));
  // A panel that is down stops new tickets from it but not a move to its types, so only what stops a ticket existing there counts.
  const typeProblem = (panelId: string, typeId: string) =>
    blocked.get(`${panelId}:${typeId}`)?.find((code) => code !== "noPanelsPosted" && code !== "panelChannelMissing" && code !== "panelMessageMissing") ?? null;

  const panels: TicketPanelOption[] = ctx.settings.panels.map((panel) => ({
    id: panel.id,
    name: panel.name,
    channelId: panel.channel ?? null,
    types: panel.types.map((type) => ({
      id: type.id,
      name: type.name,
      emoji: type.emoji ?? null,
      panelId: panel.id,
      handled: handled.has(type.id),
      requireReason: type.rules.requireReason,
      problem: typeProblem(panel.id, type.id),
      questions: type.form.map((question) => ({
        label: question.label,
        style: question.style === "short" ? ("short" as const) : ("paragraph" as const),
        required: question.required,
        ...(question.maxLength ? { maxLength: question.maxLength } : {}),
      })),
      noHandlers: health.some((issue) => issue.code === "typeNoHandlers" && issue.typeId === type.id),
    })),
  }));

  const body: TicketContextDto = {
    moduleEnabled: env.enabled,
    viewer: { userId: env.viewer.userId, name: env.viewer.name ?? "Unknown" },
    level: access.level ?? "handler",
    handledTypeIds: access.handledTypeIds,
    permissions: ticketPermissions(access),
    panels,
    priorities: TICKET_PRIORITIES,
    canUseWebhooks: guild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks) ?? false,
    replyAs: ctx.settings.general.replies.identity === "team" ? ctx.settings.general.replies.teamName.trim() || "Support Team" : null,
    health,
    dashboardUrlKnown: (await ctx.dashboardUrl()) !== "",
    closeBehaviour: ctx.settings.general.closeBehaviour === "archive" ? "archive" : "delete",
    ...(healthSummary ? { healthSummary } : {}),
    savedReplies: ctx.settings.savedReplies.map((saved) => ({ name: saved.name, content: saved.content })),
    replyFiles: { maxFiles: TICKET_REPLY_FILES_MAX, maxBytes: TICKET_REPLY_FILES_BYTES_MAX },
  };
  return ok(body);
}

/** Days a stats request may cover. Anything else reads as 30, the middle choice. */
export function statsDaysOf(value: string | null): number {
  const days = Number(value);
  return (TICKET_STATS_PERIODS as readonly number[]).includes(days) ? days : 30;
}

export async function ticketStats(env: TicketEnv, days: number): Promise<Reply> {
  const scope = viewerScope(env.access);
  if (scope === null) return fail(403, "You cannot see this server's tickets.");
  const now = new Date();
  // Enough to cover the period from midnight; computeTicketStats does the exact cut.
  const since = new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
  const ticketWhere = { AND: [{ guildId: env.guild.id }, scope] };

  const [tickets, claims] = await Promise.all([
    prisma.ticket.findMany({
      where: { AND: [ticketWhere, { OR: [{ status: "open" }, { openedAt: { gte: since } }, { closedAt: { gte: since } }, { ratedAt: { gte: since } }] }] },
      select: {
        typeId: true,
        typeName: true,
        openerId: true,
        status: true,
        openedAt: true,
        closedAt: true,
        closedBy: true,
        firstResponseAt: true,
        rating: true,
        ratedAt: true,
        firstResponderId: true,
        claimedById: true,
      },
    }),
    prisma.ticketEvent.findMany({
      where: { kind: "claimed", createdAt: { gte: since }, ticket: ticketWhere },
      select: { actorId: true, createdAt: true },
    }),
  ]);

  const typeNames = new Map(allTypes(env.ctx.settings).map(({ type }) => [type.id, type.name]));
  const stats = computeTicketStats({ tickets, claims, now, days, typeNames, botId: env.client.user?.id ?? null });
  const refs = await resolveUsers(env.client, env.guild, stats.byHandler.map((entry) => entry.userId), { maxFetches: 25 });

  const body: TicketStatsDto = {
    ...stats,
    byHandler: stats.byHandler.map(({ userId, ...counts }) => ({ user: refOf(refs, userId), ...counts })),
  };
  return ok(body);
}

/** `GET panels` asks Discord about every posted message now, which is what "Check again" is for. */
export async function panelList(env: TicketEnv): Promise<Reply> {
  return ok(await env.services.panelStatuses(env.ctx, { fresh: true }));
}

/** Every stored message of a ticket, in the order they were sent. */
async function storedMessages(ticketId: number) {
  return prisma.ticketMessage.findMany({ where: { ticketId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

async function transcriptTicket(env: TicketEnv, row: Ticket) {
  const claimer = row.claimedById ? (await resolveUsers(env.client, env.guild, [row.claimedById])).get(row.claimedById) : undefined;
  return {
    id: row.id,
    number: ticketNumber(row),
    guildName: env.guild.name,
    channelName: row.channelName,
    typeName: row.typeName,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    priorityLabel: priorityLabel(env.ctx.settings.labels, row.priority),
    openerId: row.openerId,
    openerName: row.openerName,
    claimedByName: row.claimedById ? (claimer?.name ?? row.claimedById) : null,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    closedBy: row.closedBy,
    closedByName: row.closedByName,
    closeReason: row.closeReason,
    answers: readTicketAnswers(row.answers),
    rating: row.rating,
  };
}

export async function transcript(env: TicketEnv, row: Ticket, format: "html" | "txt"): Promise<Reply> {
  const [ticket, messages] = await Promise.all([transcriptTicket(env, row), storedMessages(row.id)]);
  const texts = transcriptTexts(env.ctx.settings.labels);
  if (format === "html") {
    return {
      status: 200,
      body: null,
      raw: { contentType: "text/html; charset=utf-8", text: renderTranscriptHtml(ticket, messages, { texts }), filename: `ticket-${ticketNumber(row)}.html` },
    };
  }
  return {
    status: 200,
    body: null,
    raw: { contentType: "text/plain; charset=utf-8", text: renderStoredTranscriptText(ticket, messages, texts), filename: `ticket-${ticketNumber(row)}.txt` },
  };
}

/**
 * The Message creator templates marked available in tickets, for the reply
 * box. Only what a reply can use is sent: buttons, menus and reactions stay
 * behind, and so does everything about when it was sent. The server's facts
 * come along so the box can fill `{server}` and the like the way a send does.
 */
export async function ticketTemplates(env: TicketEnv): Promise<Reply> {
  const { guild } = env;
  const rows = await prisma.messageTemplate.findMany({
    where: { guildId: guild.id, inTickets: true },
    include: { folder: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const body: TicketTemplatesDto = {
    templates: rows.map((row) => {
      const { content, embeds, buttons, selects, reactions } = storedBody(row);
      const leftOut: TicketTemplateDto["leftOut"] = [
        ...(buttons.length > 0 ? ["buttons" as const] : []),
        ...(selects.length > 0 ? ["menus" as const] : []),
        ...(reactions.length > 0 ? ["reactions" as const] : []),
      ];
      return { id: row.id, name: row.name, folder: row.folder?.name ?? null, content, embeds, leftOut };
    }),
    variables: {
      server: guild.name,
      members: guild.memberCount.toLocaleString("en-US"),
      bot: guild.members.me?.displayName ?? guild.client.user.username,
      "server.icon": guild.iconURL({ size: 256 }) ?? "",
    },
  };
  return ok(body);
}
