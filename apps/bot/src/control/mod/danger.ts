import { prisma } from "@tier0/db";
import { can, type Actor } from "@tier0/core";
import { writeAudit } from "./audit.js";
import { forbidden, ok, refuse, type ModCtx, type Reply } from "./types.js";

export const DANGER_TARGETS = ["mod-logs", "staff-activity", "server-events", "saved-messages"] as const;
export type DangerTarget = (typeof DANGER_TARGETS)[number];

const isDangerTarget = (value: string): value is DangerTarget => DANGER_TARGETS.includes(value as DangerTarget);

const NAME: Record<DangerTarget, string> = {
  "mod-logs": "member actions",
  "staff-activity": "staff activity",
  "server-events": "server log events",
  "saved-messages": "saved messages",
};

/** Reads `targets=a,b,c`, refusing anything that is not a log this can delete. Repeats count once. */
export function parseTargets(raw: string | null): { ok: true; targets: DangerTarget[] } | { ok: false; error: string } {
  const named = (raw ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (named.length === 0) return { ok: false, error: "Choose at least one log to delete." };
  const targets: DangerTarget[] = [];
  for (const item of named) {
    if (!isDangerTarget(item)) return { ok: false, error: "One of the logs you chose is not one that can be deleted." };
    if (!targets.includes(item)) targets.push(item);
  }
  return { ok: true, targets };
}

/**
 * DELETE /mod/danger?targets=a,b -> deletes whole logs of this server for good. Only the owner can, since it
 * removes records that other staff rely on. The deletion itself is written to staff activity afterwards,
 * so even when staff activity was among what was deleted, the one entry left in it says who did that and when.
 */
export async function dangerDelete(ctx: ModCtx, actor: Actor, rawTargets: string | null): Promise<Reply> {
  const parsed = parseTargets(rawTargets);
  if (!parsed.ok) return refuse(400, parsed.error);
  if (!can(actor.role, "purge")) return forbidden("delete logs. Only the owner can");

  const guildId = ctx.guild.id;
  const has = (name: DangerTarget) => parsed.targets.includes(name);
  const counts = { cases: 0, staffActivity: 0, events: 0, messages: 0 };

  if (has("mod-logs")) counts.cases = (await prisma.infraction.deleteMany({ where: { guildId } })).count;
  if (has("staff-activity")) counts.staffActivity = (await prisma.modAudit.deleteMany({ where: { guildId } })).count;
  if (has("server-events")) counts.events = (await prisma.serverLogEntry.deleteMany({ where: { guildId } })).count;
  if (has("saved-messages")) counts.messages = (await prisma.loggedMessage.deleteMany({ where: { guildId } })).count;

  const total = counts.cases + counts.staffActivity + counts.events + counts.messages;
  await writeAudit({
    guildId,
    actor,
    kind: "logs.purge",
    summary: `Deleted ${parsed.targets.map((target) => NAME[target]).join(", ")} (${total} ${total === 1 ? "item" : "items"})`,
  });
  return ok({ deleted: total, counts });
}
