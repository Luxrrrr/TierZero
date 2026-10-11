import { prisma } from "@tier0/db";
import { can, canDeleteNote, canEditNote, type Actor, type NoteDto } from "@tier0/core";
import { writeAudit } from "./audit.js";
import { checkNoteContent, clip, isSnowflake, labelOf, noteDto, noteSnapshot, type NoteRow } from "./dto.js";
import { createLimiter } from "./limiter.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, notFound, ok, refuse, type ModCtx, type Reply } from "./types.js";

/** Live notes one member may carry; deleted ones do not count. */
export const MAX_LIVE_NOTES_PER_MEMBER = 200;
export const NOTE_ADDS_PER_MINUTE = 30;

const addLimiter = createLimiter({ limit: NOTE_ADDS_PER_MINUTE, windowMs: 60_000 });

async function present(ctx: ModCtx, row: NoteRow): Promise<NoteDto> {
  const ids = [row.userId, row.authorId];
  if (row.deletedBy) ids.push(row.deletedBy);
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  return noteDto(row, (id) => refOf(refs, id));
}

/** The note, only when it belongs to this server. */
async function findNote(ctx: ModCtx, id: number): Promise<NoteRow | null> {
  const row = await prisma.modNote.findUnique({ where: { id } });
  return row && row.guildId === ctx.guild.id ? row : null;
}

async function targetLabel(ctx: ModCtx, userId: string): Promise<string> {
  const refs = await resolveUsers(ctx.client, ctx.guild, [userId]);
  return labelOf(refOf(refs, userId));
}

/**
 * Reply for a conditional write that matched nothing. The note was either
 * purged or changed by someone else between the read and the write, and the
 * caller deserves to be told which.
 */
async function lostRace(ctx: ModCtx, id: number, changed: (note: NoteRow) => string): Promise<Reply> {
  const now = await findNote(ctx, id);
  return now ? refuse(409, changed(now)) : notFound("That note");
}

/** POST /mod/members/:userId/notes {actor, content} -> NoteDto */
export async function addNote(ctx: ModCtx, userId: string, actor: Actor, content: unknown): Promise<Reply> {
  if (!can(actor.role, "note.add")) return forbidden("add notes");
  if (!isSnowflake(userId)) return refuse(400, "That is not a valid user id.");
  const checked = checkNoteContent(content);
  if (!checked.ok) return refuse(400, checked.error);

  const taken = addLimiter.take(`${ctx.guild.id}:${actor.userId}`);
  if (!taken.ok) {
    return refuse(429, `You are adding notes too quickly. Try again in ${Math.ceil(taken.retryAfterMs / 1000)} seconds.`);
  }

  const guildId = ctx.guild.id;
  const label = await targetLabel(ctx, userId);
  const row = await prisma.$transaction(async (tx) => {
    const live = await tx.modNote.count({ where: { guildId, userId, deletedAt: null } });
    if (live >= MAX_LIVE_NOTES_PER_MEMBER) return null;
    const created = await tx.modNote.create({
      data: { guildId, userId, authorId: actor.userId, content: checked.value },
    });
    await writeAudit(
      {
        guildId,
        actor,
        kind: "note.add",
        summary: `Added a note on ${label}: ${clip(checked.value)}`,
        targetUserId: userId,
        noteId: created.id,
        after: noteSnapshot(created),
      },
      tx,
    );
    return created;
  });
  if (!row) {
    return refuse(
      409,
      `This member already has ${MAX_LIVE_NOTES_PER_MEMBER} notes. Delete some before adding more.`,
    );
  }
  return ok(await present(ctx, row));
}

/** PATCH /mod/notes/:id {actor, content} -> NoteDto */
export async function editNote(ctx: ModCtx, id: number, actor: Actor, content: unknown): Promise<Reply> {
  const note = await findNote(ctx, id);
  if (!note) return notFound("That note");
  if (!canEditNote(actor.role, note.authorId === actor.userId)) return forbidden("edit this note");
  if (note.deletedAt) return refuse(409, "That note has been deleted. Restore it before editing.");
  const checked = checkNoteContent(content);
  if (!checked.ok) return refuse(400, checked.error);
  if (checked.value === note.content) return ok(await present(ctx, note));

  const label = await targetLabel(ctx, note.userId);
  const updated = await prisma.$transaction(async (tx) => {
    // Matching on the content that was read means a second editor who read the
    // same text loses instead of silently overwriting the first.
    const changed = await tx.modNote.updateMany({
      where: { id, guildId: ctx.guild.id, deletedAt: null, content: note.content },
      data: { content: checked.value },
    });
    if (changed.count === 0) return null;
    const fresh = await tx.modNote.findUniqueOrThrow({ where: { id } });
    await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "note.edit",
        summary: `Edited a note on ${label}`,
        targetUserId: note.userId,
        noteId: id,
        before: noteSnapshot(note),
        after: noteSnapshot(fresh),
      },
      tx,
    );
    return fresh;
  });
  if (!updated) {
    return lostRace(ctx, id, (now) =>
      now.deletedAt
        ? "That note has been deleted. Restore it before editing."
        : "That note was changed by someone else a moment ago. Reload it and try again.",
    );
  }
  return ok(await present(ctx, updated));
}

/** DELETE /mod/notes/:id {actor}: hides it and leaves a trace */
export async function deleteNote(ctx: ModCtx, id: number, actor: Actor): Promise<Reply> {
  const note = await findNote(ctx, id);
  if (!note) return notFound("That note");
  if (!canDeleteNote(actor.role, note.authorId === actor.userId)) return forbidden("delete this note");
  if (note.deletedAt) return refuse(409, "That note is already deleted.");

  const label = await targetLabel(ctx, note.userId);
  const updated = await prisma.$transaction(async (tx) => {
    // updatedAt is passed through so deleting does not make the note look edited.
    const changed = await tx.modNote.updateMany({
      where: { id, guildId: ctx.guild.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: actor.userId, updatedAt: note.updatedAt },
    });
    if (changed.count === 0) return null;
    const fresh = await tx.modNote.findUniqueOrThrow({ where: { id } });
    await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "note.delete",
        summary: `Deleted a note on ${label}: ${clip(note.content)}`,
        targetUserId: note.userId,
        noteId: id,
        before: noteSnapshot(note),
        after: noteSnapshot(fresh),
      },
      tx,
    );
    return fresh;
  });
  if (!updated) return lostRace(ctx, id, () => "That note is already deleted.");
  return ok(await present(ctx, updated));
}

/** POST /mod/notes/:id/restore {actor} */
export async function restoreNote(ctx: ModCtx, id: number, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "note.restore")) return forbidden("restore notes");
  const note = await findNote(ctx, id);
  if (!note) return notFound("That note");
  if (!note.deletedAt) return refuse(409, "That note has not been deleted.");

  const label = await targetLabel(ctx, note.userId);
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.modNote.updateMany({
      where: { id, guildId: ctx.guild.id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, updatedAt: note.updatedAt },
    });
    if (changed.count === 0) return null;
    const fresh = await tx.modNote.findUniqueOrThrow({ where: { id } });
    await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "note.restore",
        summary: `Restored a note on ${label}: ${clip(note.content)}`,
        targetUserId: note.userId,
        noteId: id,
        before: noteSnapshot(note),
        after: noteSnapshot(fresh),
      },
      tx,
    );
    return fresh;
  });
  if (!updated) return lostRace(ctx, id, () => "That note has not been deleted.");
  return ok(await present(ctx, updated));
}

/** DELETE /mod/notes/:id?purge=1 {actor}: owner only; removes the note and every audit row about it, leaving nothing */
export async function purgeNote(ctx: ModCtx, id: number, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "purge")) return forbidden("permanently delete notes");

  // The row is deleted first and its count decides the outcome, so a second
  // purge of the same note finds nothing to remove and answers 404 instead of
  // throwing.
  const purged = await prisma.$transaction(async (tx) => {
    const removed = await tx.modNote.deleteMany({ where: { id, guildId: ctx.guild.id } });
    if (removed.count === 0) return false;
    await tx.modAudit.deleteMany({ where: { guildId: ctx.guild.id, noteId: id } });
    return true;
  });
  return purged ? ok({ purged: true }) : notFound("That note");
}
