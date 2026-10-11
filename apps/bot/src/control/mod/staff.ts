import { isUniqueConflict, prisma } from "@tier0/db";
import { can, type Actor, type ListedRole, type StaffDto } from "@tier0/core";
import { writeAudit } from "./audit.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, notFound, ok, refuse, type ModCtx, type Reply } from "./types.js";

const SNOWFLAKE = /^\d{17,20}$/;

const isListedRole = (value: unknown): value is ListedRole => value === "admin" || value === "mod";

type StaffRow = { userId: string; role: string; addedBy: string; addedAt: Date };

async function toDtos(ctx: ModCtx, rows: StaffRow[]): Promise<StaffDto[]> {
  const refs = await resolveUsers(ctx.client, ctx.guild, rows.flatMap((row) => [row.userId, row.addedBy]));
  return rows.map((row) => ({
    user: refOf(refs, row.userId),
    // Only admin and mod are ever written, so anything else is a damaged row and gets the lesser role.
    role: isListedRole(row.role) ? row.role : "mod",
    addedBy: refOf(refs, row.addedBy),
    addedAt: row.addedAt.toISOString(),
  }));
}

/** GET /mod/staff -> StaffDto[] */
export async function listStaff(ctx: ModCtx): Promise<Reply> {
  const rows = await prisma.staffMember.findMany({
    where: { guildId: ctx.guild.id },
    orderBy: [{ addedAt: "asc" }, { userId: "asc" }],
  });
  return ok(await toDtos(ctx, rows));
}

/** PUT /mod/staff/:userId {actor, role: "admin" or "mod"} -> StaffDto. Owner only. */
export async function setStaff(ctx: ModCtx, userId: string, actor: Actor, role: unknown): Promise<Reply> {
  if (!can(actor.role, "staff.manage")) return forbidden("manage staff");
  if (!SNOWFLAKE.test(userId)) return refuse(400, "That does not look like a Discord user id.");
  if (!isListedRole(role)) return refuse(400, "The role must be admin or mod.");

  const user = ctx.client.users.cache.get(userId) ?? (await ctx.client.users.fetch(userId).catch(() => null));
  if (user?.bot) return refuse(400, "Bots cannot be given a staff role.");

  const guildId = ctx.guild.id;
  const key = { guildId_userId: { guildId, userId } };
  const name = refOf(await resolveUsers(ctx.client, ctx.guild, [userId]), userId).name ?? userId;
  const changedMeanwhile = refuse(409, "That staff entry was just changed by someone else. Reload and try again.");

  let outcome: { row: StaffRow; unchanged: boolean } | "raced";
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.staffMember.findUnique({ where: key });
      if (existing?.role === role) return { row: existing, unchanged: true };

      let row: StaffRow;
      if (existing) {
        // The old role in the condition is what makes a second concurrent
        // change lose rather than write over the first.
        const changed = await tx.staffMember.updateMany({ where: { guildId, userId, role: existing.role }, data: { role } });
        if (changed.count === 0) return "raced" as const;
        row = await tx.staffMember.findUniqueOrThrow({ where: key });
      } else {
        row = await tx.staffMember.create({ data: { guildId, userId, role, addedBy: actor.userId } });
      }
      await writeAudit(
        {
          guildId,
          actor,
          kind: existing ? "staff.update" : "staff.add",
          summary: existing ? `Changed ${name} from ${existing.role} to ${role}` : `Added ${name} as ${role}`,
          targetUserId: userId,
          before: existing ? { role: existing.role } : undefined,
          after: { role },
        },
        tx,
      );
      return { row, unchanged: false };
    });
  } catch (error) {
    // Two first-time adds of the same person: the unique key rejects the second.
    if (isUniqueConflict(error)) return changedMeanwhile;
    throw error;
  }
  if (outcome === "raced") return changedMeanwhile;

  const [dto] = await toDtos(ctx, [outcome.row]);
  return ok(dto);
}

/** DELETE /mod/staff/:userId {actor}. Owner only. */
export async function removeStaff(ctx: ModCtx, userId: string, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "staff.manage")) return forbidden("manage staff");
  if (!SNOWFLAKE.test(userId)) return refuse(400, "That does not look like a Discord user id.");

  const guildId = ctx.guild.id;
  const name = refOf(await resolveUsers(ctx.client, ctx.guild, [userId]), userId).name ?? userId;

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.staffMember.findUnique({ where: { guildId_userId: { guildId, userId } } });
    if (!existing) return "missing" as const;
    const removed = await tx.staffMember.deleteMany({ where: { guildId, userId, role: existing.role } });
    if (removed.count === 0) return "raced" as const;
    await writeAudit(
      {
        guildId,
        actor,
        kind: "staff.remove",
        summary: `Removed ${name} (${existing.role}) from staff`,
        targetUserId: userId,
        before: { role: existing.role },
      },
      tx,
    );
    return "removed" as const;
  });
  if (outcome === "missing") return notFound("That staff member");
  if (outcome === "raced") return refuse(409, "That staff entry was just changed by someone else. Reload and try again.");
  return ok({ removed: true });
}
