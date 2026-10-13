/**
 * Decisions the ticket module has to make that do not touch Discord itself.
 * Kept free of discord.js so they can be unit tested directly.
 */

const CATEGORY_CHILD_LIMIT = 50;

/**
 * Why a ticket cannot be opened. It is a code rather than a sentence: the
 * wording belongs to the server's settings, and the caller looks it up there.
 */
export type OpenRefusal = "categoryGone" | "categoryFull" | "limitOne" | "limitMany";

export type OpenTicketDecision =
  | { allowed: true }
  | { allowed: false; code: OpenRefusal; openCount: number; limit: number };

export interface OpenTicketRequest {
  /** How many tickets this member already has open. */
  openCount: number;
  /** The configured cap on open tickets per member. */
  limit: number;
  /** Whether the configured ticket category still exists. */
  categoryExists: boolean;
  /** How many channels the category currently holds, if it exists. */
  categoryChildCount: number;
}

/**
 * Everything that can stop a ticket from being opened, checked before any
 * channel is created. A member gets a clear reason instead of a failed
 * interaction.
 */
export function evaluateOpenRequest(request: OpenTicketRequest): OpenTicketDecision {
  const refuse = (code: OpenRefusal): OpenTicketDecision => ({
    allowed: false,
    code,
    openCount: request.openCount,
    limit: request.limit,
  });
  if (!request.categoryExists) return refuse("categoryGone");
  if (request.categoryChildCount >= CATEGORY_CHILD_LIMIT) return refuse("categoryFull");
  if (request.openCount >= request.limit) return refuse(request.limit === 1 ? "limitOne" : "limitMany");
  return { allowed: true };
}

/**
 * Whether a member is allowed to manage tickets: close someone else's, or add
 * and remove members from one. The opener may always close their own ticket;
 * everyone else needs a support role or the standing permission to manage
 * channels outright.
 */
export function canManageTicket(member: {
  id: string;
  isOpener: boolean;
  roleIds: string[];
  hasManageChannels: boolean;
}, supportRoleIds: string[]): boolean {
  if (member.isOpener) return true;
  if (member.hasManageChannels) return true;
  return member.roleIds.some((id) => supportRoleIds.includes(id));
}
