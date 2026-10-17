import { prisma, type Ticket } from "@tier0/db";
import {
  canTicket,
  readTicketClose,
  readTicketMembers,
  readTicketNote,
  readTicketPriority,
  readTicketRename,
  readTicketReply,
  readTicketRequestClose,
  readTicketTransfer,
  TICKET_REPLY_RATE_PER_MINUTE,
  type TicketActionResult,
  type TicketActor,
  type TicketError,
  type TicketPermission,
} from "@tier0/core";
import { createLimiter } from "../mod/limiter.js";
import { accessTarget } from "./dto.js";
import { ticketDetail } from "./detail.js";
import { allTypes } from "./runtime.js";
import { fail, ok, OTHER_TYPE, type Reply, type TicketEnv } from "./types.js";

/**
 * Ticket writes from the dashboard. The work is the tickets module's, the same
 * functions the slash commands and buttons call; this file decides whether
 * the viewer may ask, validates the body, and turns the module's answer into
 * a reply. Each write answers with the ticket as this viewer now sees it.
 */

export const TICKET_ACTIONS = [
  "reply",
  "claim",
  "unclaim",
  "priority",
  "notes",
  "members",
  "transfer",
  "close",
  "reopen",
  "rename",
  "request-close",
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export function isTicketAction(value: string | undefined): value is TicketAction {
  return value !== undefined && (TICKET_ACTIONS as readonly string[]).includes(value);
}

export const ACTION_PERMISSION: Record<TicketAction, TicketPermission> = {
  reply: "reply",
  claim: "claim",
  unclaim: "unclaim",
  priority: "priority",
  notes: "note",
  members: "members",
  transfer: "transfer",
  close: "close",
  reopen: "reopen",
  rename: "rename",
  "request-close": "requestClose",
};

/** Why a write was refused, in words that say what to do. */
const REFUSED: Record<TicketPermission, string> = {
  view: OTHER_TYPE,
  reply: "You cannot reply to this ticket. It may be closed, or claimed by someone else while claims lock other handlers out.",
  claim: "This ticket cannot be claimed. It may be closed, already claimed, or of a type with claiming switched off.",
  unclaim: "You cannot drop this claim. Only whoever claimed the ticket, an admin role or a manager can.",
  priority: "The priority of a closed ticket cannot change. Reopen it first.",
  note: OTHER_TYPE,
  members: "Members can only be added to or removed from an open ticket.",
  transfer: "Only an open ticket can be moved to another type.",
  close: "This ticket is already closed.",
  reopen: "This ticket cannot be reopened. Only a ticket whose channel was kept can be, and only when reopening is switched on.",
  deleteTranscript: "Only a member with Manage Server can delete a transcript, and only of a closed ticket.",
  stats: OTHER_TYPE,
  settings: "Only a member with Manage Server can do that.",
  rename: "Only an open ticket can be renamed.",
  requestClose: "Only an open ticket can be asked to close.",
};

export function refusedText(permission: TicketPermission): string {
  return REFUSED[permission];
}

const replies = createLimiter({ limit: TICKET_REPLY_RATE_PER_MINUTE, windowMs: 60_000 });

const STATUS_OF_CODE: Record<NonNullable<TicketError["code"]>, 400 | 403 | 404 | 409 | 429 | 503> = {
  invalid: 400,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  rateLimited: 429,
  unavailable: 503,
};

/**
 * A refusal from the module, which throws an error carrying a `TicketError`
 * code and a sentence written for the dashboard. Anything without a known code
 * is a fault, which the control server logs and answers with a plain 500.
 */
export function moduleRefusal(error: unknown): Reply | null {
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !Object.hasOwn(STATUS_OF_CODE, code)) return null;
  return fail(STATUS_OF_CODE[code as keyof typeof STATUS_OF_CODE], error.message);
}

async function afterWrite(env: TicketEnv, ticketId: number, notes: readonly string[] | undefined): Promise<Reply> {
  const row = await prisma.ticket.findFirst({ where: { id: ticketId, guildId: env.guild.id } });
  // A ticket whose channel was deleted at close keeps its row, so this only happens if something removed it meanwhile.
  if (!row) return fail(404, "That ticket no longer exists.");
  const body: TicketActionResult = { ticket: await ticketDetail(env, row), notes: [...(notes ?? [])] };
  return ok(body);
}

export async function writeTicket(env: TicketEnv, row: Ticket, action: TicketAction, actor: TicketActor, payload: unknown): Promise<Reply> {
  const permission = ACTION_PERMISSION[action];
  if (!canTicket(env.access, permission, accessTarget(row))) {
    return fail(canTicket(env.access, "view", accessTarget(row)) ? 409 : 403, refusedText(permission));
  }

  const { ctx, services } = env;
  try {
    switch (action) {
      case "reply": {
        const read = readTicketReply(payload);
        if (!read.ok) return fail(400, read.error);
        const taken = replies.take(`${env.guild.id}:${actor.userId}`);
        if (!taken.ok) {
          return fail(429, `You are sending replies too quickly. Try again in ${Math.ceil(taken.retryAfterMs / 1000)} seconds.`);
        }
        return ok(await services.replyToTicket(ctx, row.id, read.value.content, actor, read.value.files ?? []));
      }
      case "claim":
        return afterWrite(env, row.id, (await services.claimTicket(ctx, row.id, actor)).notes);
      case "unclaim":
        return afterWrite(env, row.id, (await services.unclaimTicket(ctx, row.id, actor)).notes);
      case "priority": {
        const read = readTicketPriority(payload);
        if (!read.ok) return fail(400, read.error);
        return afterWrite(env, row.id, (await services.setTicketPriority(ctx, row.id, read.value.priority, actor)).notes);
      }
      case "notes": {
        const read = readTicketNote(payload);
        if (!read.ok) return fail(400, read.error);
        return afterWrite(env, row.id, (await services.addTicketNote(ctx, row.id, read.value.body, actor)).notes);
      }
      case "members": {
        const read = readTicketMembers(payload);
        if (!read.ok) return fail(400, read.error);
        return afterWrite(env, row.id, (await services.changeTicketMember(ctx, row.id, read.value, actor)).notes);
      }
      case "transfer": {
        const read = readTicketTransfer(payload);
        if (!read.ok) return fail(400, read.error);
        if (!allTypes(ctx.settings).some(({ type }) => type.id === read.value.typeId)) {
          return fail(400, "That ticket type no longer exists. Reload the page and pick another.");
        }
        if ((row.typeId ?? "") === read.value.typeId) return fail(400, "The ticket is already of that type.");
        return afterWrite(env, row.id, (await services.transferTicket(ctx, row.id, read.value, actor)).notes);
      }
      case "close": {
        const read = readTicketClose(payload);
        if (!read.ok) return fail(400, read.error);
        const close = read.value.reason === null ? {} : { reason: read.value.reason };
        return afterWrite(env, row.id, (await services.closeTicketAs(ctx, row.id, close, actor)).notes);
      }
      case "reopen":
        return afterWrite(env, row.id, (await services.reopenTicket(ctx, row.id, actor)).notes);
      case "rename": {
        const read = readTicketRename(payload);
        if (!read.ok) return fail(400, read.error);
        return afterWrite(env, row.id, (await services.renameTicket(ctx, row.id, read.value.name, actor)).notes);
      }
      case "request-close": {
        const read = readTicketRequestClose(payload);
        if (!read.ok) return fail(400, read.error);
        return afterWrite(env, row.id, (await services.requestTicketClose(ctx, row.id, read.value, actor)).notes);
      }
    }
  } catch (error) {
    const refusal = moduleRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

/**
 * Removes a closed ticket's stored messages for good. The ticket row, its
 * events and notes stay, so the inbox still lists it; the audit row records
 * who did it, in the same transaction as the delete.
 */
export async function deleteTranscript(env: TicketEnv, row: Ticket, actor: TicketActor): Promise<Reply> {
  if (!canTicket(env.access, "deleteTranscript", accessTarget(row))) {
    return fail(env.access.level === "manager" ? 409 : 403, refusedText("deleteTranscript"));
  }
  const removed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.ticketMessage.deleteMany({ where: { ticketId: row.id } });
    // Kept on the ticket as well as in the audit, so the transcript can say who deleted it and when.
    await tx.ticket.update({
      where: { id: row.id },
      data: { transcriptDeletedAt: new Date(), transcriptDeletedById: actor.userId, transcriptDeletedByName: actor.name },
    });
    await tx.ticketAudit.create({
      data: {
        guildId: env.guild.id,
        actorId: actor.userId,
        actorName: actor.name,
        kind: "transcript.delete",
        ticketId: row.id,
        detail: JSON.stringify({ messages: deleted.count, typeName: row.typeName, openerId: row.openerId }),
      },
    });
    return deleted.count;
  });
  return ok({ deleted: removed });
}

export async function postPanelFor(env: TicketEnv, panelId: string, actor: TicketActor): Promise<Reply> {
  if (!env.ctx.settings.panels.some((panel) => panel.id === panelId)) {
    return fail(404, "That panel no longer exists. Reload the page; it may have been removed in Settings.");
  }
  try {
    return ok(await env.services.postPanel(env.ctx, panelId, actor));
  } catch (error) {
    const refusal = moduleRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
