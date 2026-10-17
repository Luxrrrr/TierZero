import type { GuildMember } from "discord.js";
import { prisma } from "@tier0/db";
import type { MemberProfile, MemberSearchHit, Page, UserRef } from "@tier0/core";
import { toAuditDtos } from "./audit-list.js";
import {
  filterMembers,
  infractionDto,
  isSnowflake,
  matchesMember,
  noteDto,
  parseMemberFilter,
  parseMemberSort,
  slicePage,
  sortMembers,
  summarizeMember,
  withUser,
  type InfractionRow,
  type MemberEntry,
  type NoteRow,
} from "./dto.js";
import { refOf, resolveUsers, withinBudget } from "./names.js";
import { ok, pageOf, refuse, type ModCtx, type Reply } from "./types.js";

const SEARCH_LIMIT = 10;
const PROFILE_AUDIT_LIMIT = 1000;
/** Most Discord lookups one request may start; the rest show by id and fill in on a later load. */
const MAX_NAME_LOOKUPS = 100;
const LOOKUPS = { maxFetches: MAX_NAME_LOOKUPS };

function group<T extends { userId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.userId);
    if (list) list.push(row);
    else grouped.set(row.userId, [row]);
  }
  return grouped;
}

function refFromMember(member: GuildMember): UserRef {
  return {
    userId: member.id,
    name: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    inServer: true,
  };
}

/** GET /mod/members?q=&filter=all|active|notes|recent&sort=recent|most|name|notes&page=&pageSize= -> Page of MemberSummary */
export async function listMembers(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const { client, guild } = ctx;
  const q = (query.get("q") ?? "").trim();
  const sort = parseMemberSort(query.get("sort"));
  const filter = parseMemberFilter(query.get("filter"));
  const { page, pageSize } = pageOf(query);
  const now = new Date();

  const [infractions, notes] = await Promise.all([
    prisma.infraction.findMany({ where: { guildId: guild.id, voidedAt: null } }),
    prisma.modNote.findMany({ where: { guildId: guild.id, deletedAt: null } }),
  ]);
  const byInfraction = group<InfractionRow>(infractions);
  const byNote = group<NoteRow>(notes);
  const ids = [...new Set([...byInfraction.keys(), ...byNote.keys()])];

  // The filter only reads counts and dates, so it narrows the list before any
  // name is looked up.
  const unnamed = (id: string): UserRef => ({ userId: id, name: null, avatarUrl: null, inServer: false });
  let entries = filterMembers(
    ids.map((id) => summarizeMember(unnamed(id), byInfraction.get(id) ?? [], byNote.get(id) ?? [], now, ctx.warnExpiryMs ?? null)),
    filter,
    now,
  );

  // Names are only needed up front when they decide what is shown or in what
  // order; otherwise resolving just the visible page saves a lookup per member.
  const needsNames = sort === "name" || q !== "";
  if (needsNames) {
    const refs = await resolveUsers(client, guild, entries.map((entry) => entry.summary.user.userId), LOOKUPS);
    entries = entries.map((entry) => withUser(entry, refOf(refs, entry.summary.user.userId)));
    if (q !== "") entries = entries.filter((entry) => matchesMember(entry.summary.user, q));
  }
  entries = sortMembers(entries, sort);

  const total = entries.length;
  let items = slicePage(entries, page, pageSize);
  if (!needsNames) {
    const refs = await resolveUsers(
      client,
      guild,
      items.map((entry) => entry.summary.user.userId),
      LOOKUPS,
    );
    items = items.map((entry) => withUser(entry, refOf(refs, entry.summary.user.userId)));
  }

  const body: Page<MemberEntry["summary"]> = {
    items: items.map((entry) => entry.summary),
    total,
    page,
    pageSize,
  };
  return ok(body);
}

/** GET /mod/members/:userId -> MemberProfile */
export async function memberProfile(ctx: ModCtx, userId: string): Promise<Reply> {
  const { client, guild } = ctx;
  if (!isSnowflake(userId)) return refuse(400, "That is not a valid user id.");

  const [infractions, notes, auditRows] = await Promise.all([
    prisma.infraction.findMany({ where: { guildId: guild.id, userId }, orderBy: { id: "desc" } }),
    prisma.modNote.findMany({ where: { guildId: guild.id, userId }, orderBy: { id: "desc" } }),
    prisma.modAudit.findMany({
      where: { guildId: guild.id, targetUserId: userId },
      orderBy: { id: "desc" },
      take: PROFILE_AUDIT_LIMIT,
    }),
  ]);

  // Both lookups are capped like the name batch, and run alongside it, so the
  // profile waits on Discord for one budget in total rather than three.
  const lookups = (async () => {
    const found = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    const account = found?.user ?? (await client.users.fetch(userId).catch(() => null));
    return { found, account };
  })();

  const ids = new Set<string>([userId]);
  for (const row of infractions) {
    ids.add(row.moderatorId);
    if (row.voidedBy) ids.add(row.voidedBy);
    if (row.editedBy) ids.add(row.editedBy);
  }
  for (const row of notes) {
    ids.add(row.authorId);
    if (row.deletedBy) ids.add(row.deletedBy);
  }
  const [refs, { found: member, account: user }] = await Promise.all([
    resolveUsers(client, guild, ids, LOOKUPS),
    withinBudget(lookups, { found: null, account: null }),
  ]);
  const ref = (id: string) => refOf(refs, id);

  // A member with nothing on record still gets a profile (named only if
  // Discord answered in time), so a first note can be added to a clean member.
  const target = ref(userId);

  const profile: MemberProfile = {
    user: target,
    joinedAt: member?.joinedAt ? member.joinedAt.toISOString() : null,
    accountCreatedAt: user ? user.createdAt.toISOString() : null,
    roles: member
      ? [...member.roles.cache.values()]
          .filter((role) => role.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map((role) => ({ id: role.id, name: role.name }))
      : [],
    summary: summarizeMember(target, infractions, notes, new Date(), ctx.warnExpiryMs ?? null).summary,
    infractions: infractions.map((row) => infractionDto(row, ref, ctx.warnExpiryMs ?? null)),
    notes: notes.map((row) => noteDto(row, ref)),
    audit: await toAuditDtos(ctx, auditRows, refs),
  };
  return ok(profile);
}

/** GET /mod/member-search?q= -> MemberSearchHit[], guild members matching a name, for pickers */
export async function searchGuildMembers(ctx: ModCtx, query: string): Promise<Reply> {
  const { guild } = ctx;
  const q = query.trim();
  if (q === "") return ok([] satisfies MemberSearchHit[]);

  const found = new Map<string, GuildMember>();
  if (isSnowflake(q)) {
    const exact =
      guild.members.cache.get(q) ?? (await withinBudget(guild.members.fetch(q).catch(() => null), null));
    if (exact) found.set(exact.id, exact);
  }

  const results = await withinBudget(guild.members.search({ query: q, limit: SEARCH_LIMIT }).catch(() => null), null);
  if (results) {
    for (const member of results.values()) found.set(member.id, member);
  } else {
    const needle = q.toLowerCase();
    for (const member of guild.members.cache.values()) {
      if (member.displayName.toLowerCase().includes(needle) || member.user.username.toLowerCase().includes(needle)) {
        found.set(member.id, member);
      }
    }
  }

  const hits: MemberSearchHit[] = [...found.values()]
    .slice(0, SEARCH_LIMIT)
    .map((member) => ({ user: refFromMember(member) }));
  return ok(hits);
}
