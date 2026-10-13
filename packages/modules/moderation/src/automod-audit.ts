import type { Client } from "discord.js";
import { AUTOMOD_ACTOR_NAME } from "@tier0/core";
import { prisma } from "@tier0/db";

export interface AutomodCaseFacts {
  guildId: string;
  /** The bot's own user id, which is who automod acts as. */
  botUserId: string;
  targetUserId: string;
  /** Null when the name is not at hand, which reads as the id. */
  targetName: string | null;
  infractionId: number;
  caseNumber: number;
  /** The case's action, such as "automod-warn". */
  action: string;
  /** What really happened, which the case alone cannot say: it keeps only the strongest. */
  deleted?: boolean;
  warned?: boolean;
  timedOut?: boolean;
  /**
   * What the member did, with what matched, as `staffReasonOf` writes it. Staff
   * only: this goes into the audit summary and nowhere a member or a channel can read it.
   */
  reason: string | null;
  /** Defaults to now. A backfilled entry is dated to its case. */
  at?: Date;
}

const CLIP = 200;
/** How long a reason could be before the match was added to it. */
const legacyClip = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}...` : text);
const clip = (text: string): string => (text.length > CLIP ? `${text.slice(0, CLIP - 3)}...` : text);

/** What the case's action says automod did, for when nothing finer is known. */
function flagsFromAction(action: string): { deleted: boolean; warned: boolean; timedOut: boolean } {
  return {
    deleted: action === "automod-delete",
    warned: action === "automod-warn",
    timedOut: action === "automod-timeout",
  };
}

/**
 * One line for Staff activity, in the wording of the entries staff write for
 * their own actions. The trail is staff-only, so the reason carries what
 * matched, such as the invite code or the banned words.
 */
export function automodAuditSummary(facts: AutomodCaseFacts): string {
  const known = facts.deleted || facts.warned || facts.timedOut;
  const done = known
    ? { deleted: !!facts.deleted, warned: !!facts.warned, timedOut: !!facts.timedOut }
    : flagsFromAction(facts.action);
  const name = facts.targetName ?? facts.targetUserId;

  const parts: string[] = [];
  if (done.deleted) parts.push(`deleted a message from ${name}`);
  if (done.warned) parts.push(parts.length ? "warned them" : `warned ${name}`);
  if (done.timedOut) parts.push(parts.length ? "timed them out" : `timed out ${name}`);
  // A rule that managed nothing is still filed as a warning, so that is what this says.
  if (parts.length === 0) parts.push(`warned ${name}`);

  const verbs = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `Automod ${verbs} (case #${facts.caseNumber})${facts.reason ? `: ${clip(facts.reason)}` : ""}`;
}

/**
 * Leaves the line in Staff activity that says automod acted, because a case
 * made by a rule has no person behind it and would otherwise be absent from
 * the trail while every other action is in it. Never throws: the case is
 * already made, and a failed note must not disturb the message flow. Returns whether the entry was written.
 */
export async function auditAutomodCase(facts: AutomodCaseFacts): Promise<boolean> {
  try {
    await prisma.modAudit.create({
      data: {
        guildId: facts.guildId,
        ...(facts.at ? { at: facts.at } : {}),
        actorId: facts.botUserId,
        actorName: AUTOMOD_ACTOR_NAME,
        actorRole: "automod",
        kind: "action.take",
        targetUserId: facts.targetUserId,
        infractionId: facts.infractionId,
        summary: automodAuditSummary(facts),
        // The snapshot keeps only the fixed wording: what matched is in the summary and on the case.
        after: JSON.stringify({ action: facts.action, caseNumber: facts.caseNumber, reason: facts.reason?.split(" (matched ")[0] ?? null }),
      },
    });
    return true;
  } catch (error) {
    console.error("automod: could not write the audit entry for a case:", error);
    return false;
  }
}

/**
 * The reason as the audit summary shows it, out of a stored automod reason
 * that reads "rule: wording", then maybe " (matched `x`)" and " (problems)".
 * The rule name is dropped because the case shows it, and so are the problems
 * because the line already says what automod managed to do. The match stays,
 * without the code-span backticks, which only make sense on the case itself.
 */
export function staffReasonOf(stored: string | null): string | null {
  if (!stored) return null;
  let text = stored;
  const problems = text.indexOf(" (Could not ");
  if (problems >= 0) text = text.slice(0, problems);
  const colon = text.indexOf(": ");
  let wording = colon >= 0 ? text.slice(colon + 2).trim() : "";
  const matched = wording.indexOf(" (matched ");
  if (matched >= 0) wording = wording.slice(0, matched) + wording.slice(matched).replace(/`/g, "");
  return wording || null;
}

/**
 * A member's name for an old entry, from what the library holds and then one
 * lookup. Best effort: a member who left and whose account Discord no longer
 * knows stays null, and the entry keeps their id.
 */
async function nameFromClient(client: Client, guildId: string, userId: string): Promise<string | null> {
  const cached = client.guilds.cache.get(guildId)?.members.cache.get(userId)?.displayName ?? client.users.cache.get(userId)?.displayName;
  if (cached) return cached;
  try {
    const user = await client.users.fetch(userId);
    return user?.displayName ?? null;
  } catch {
    return null;
  }
}

/**
 * Older automod cases were never written to the audit trail. Gives each one an
 * entry, dated to the case, built from what the case stored. Safe to run on
 * every start: a case that already has an action entry is skipped.
 */
export async function backfillAutomodAudit(client: Client): Promise<number> {
  const botUserId = client.user?.id;
  if (!botUserId) return 0;

  const cases = await prisma.infraction.findMany({
    where: { moderatorId: botUserId, action: { startsWith: "automod-" } },
    select: { id: true, guildId: true, userId: true, caseNumber: true, action: true, reason: true, createdAt: true },
  });
  if (cases.length === 0) return 0;

  const have = new Set(
    (
      await prisma.modAudit.findMany({
        where: { kind: "action.take", infractionId: { in: cases.map((row) => row.id) } },
        select: { infractionId: true },
      })
    ).map((row) => row.infractionId),
  );

  const names = new Map<string, string | null>();
  const nameOf = async (guildId: string, userId: string): Promise<string | null> => {
    if (!names.has(userId)) names.set(userId, await nameFromClient(client, guildId, userId));
    return names.get(userId) ?? null;
  };

  let written = 0;
  for (const row of cases) {
    if (have.has(row.id)) continue;
    const name = await nameOf(row.guildId, row.userId);
    const done = await auditAutomodCase({
      guildId: row.guildId,
      botUserId,
      targetUserId: row.userId,
      targetName: name,
      infractionId: row.id,
      caseNumber: row.caseNumber,
      action: row.action,
      reason: staffReasonOf(row.reason),
      at: row.createdAt,
    });
    if (done) written += 1;
  }
  return written;
}

const HEAD = /^(Automod .+? \(case #(\d+)\))(?:: (.*))?$/s;

/**
 * Rewrites automod entries written before the summary carried names and the
 * match: a raw member id becomes the member's name when it can be found, and a
 * reason that lost its match is rebuilt from the case. Only entries in the
 * shape this module writes are touched, and one that already reads right is
 * left alone, so every start after the first writes nothing. Returns how many
 * entries were rewritten.
 */
export async function repairAutomodAudit(client: Client): Promise<number> {
  const rows = await prisma.modAudit.findMany({
    where: { actorRole: "automod", kind: "action.take", infractionId: { not: null }, targetUserId: { not: null } },
    select: { id: true, guildId: true, targetUserId: true, infractionId: true, summary: true },
  });
  if (rows.length === 0) return 0;

  const cases = new Map(
    (
      await prisma.infraction.findMany({
        where: { id: { in: rows.map((row) => row.infractionId!) } },
        select: { id: true, caseNumber: true, reason: true },
      })
    ).map((row) => [row.id, row]),
  );

  const names = new Map<string, string | null>();
  let rewritten = 0;
  for (const row of rows) {
    const found = cases.get(row.infractionId!);
    const parts = HEAD.exec(row.summary);
    if (!found || !parts || Number(parts[2]) !== found.caseNumber) continue;

    let head = parts[1]!;
    const userId = row.targetUserId!;
    if (head.includes(userId)) {
      if (!names.has(userId)) names.set(userId, await nameFromClient(client, row.guildId, userId));
      const name = names.get(userId);
      if (name) head = head.split(userId).join(name);
    }

    // The tail is only replaced when it is what this module wrote before, the
    // wording without its match. A case whose reason staff have since edited
    // no longer matches that, and the entry keeps what it said.
    const reason = staffReasonOf(found.reason);
    const old = parts[3];
    const wording = reason?.split(" (matched ")[0] ?? null;
    const written = old !== undefined && wording !== null && (old === wording || old === legacyClip(wording));
    const tail = reason && written ? clip(reason) : old;
    const next = `${head}${tail !== undefined ? `: ${tail}` : ""}`;
    if (next === row.summary) continue;
    await prisma.modAudit.update({ where: { id: row.id }, data: { summary: next } });
    rewritten += 1;
  }
  return rewritten;
}
