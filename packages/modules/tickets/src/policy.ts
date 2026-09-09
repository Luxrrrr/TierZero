/**
 * Decisions the ticket module has to make that do not touch Discord itself.
 * Kept free of discord.js so they can be unit tested directly.
 */

const CATEGORY_CHILD_LIMIT = 50;

export type OpenTicketDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

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
  if (!request.categoryExists) {
    return {
      allowed: false,
      reason:
        "The ticket category no longer exists. Ask a server admin to set a new one in the dashboard.",
    };
  }
  if (request.categoryChildCount >= CATEGORY_CHILD_LIMIT) {
    return {
      allowed: false,
      reason:
        "The ticket category is full. Ask a server admin to close old tickets or choose a different category.",
    };
  }
  if (request.openCount >= request.limit) {
    return {
      allowed: false,
      reason:
        request.limit === 1
          ? "You already have an open ticket. Close it before opening another."
          : `You already have ${request.openCount} open tickets, the most this server allows. Close one before opening another.`,
    };
  }
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
