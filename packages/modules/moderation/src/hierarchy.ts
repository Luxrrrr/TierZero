/**
 * Whether a moderation action may go ahead, given nothing but role positions.
 * Kept free of discord.js so this - the highest-risk decision in the module -
 * can be exercised without a guild, a member, or a gateway connection.
 *
 * Position comparisons use ">=", not ">", matching how Discord itself
 * enforces role hierarchy: a role does not outrank one sitting at the same
 * position, so equal footing gets refused, never allowed.
 */

export interface HierarchyCheck {
  /** Position of the acting moderator's highest role. Ignored when actorIsOwner. */
  actorTopRole: number;
  /** Position of the target's highest role. */
  targetTopRole: number;
  /** Position of the bot's own highest role. */
  botTopRole: number;
  /** The target is the server owner. Nobody may action the owner, ever. */
  targetIsOwner: boolean;
  /** The acting moderator is the server owner, who bypasses the role check below. */
  actorIsOwner: boolean;
  /**
   * Whether the action asks Discord to change something about the target.
   * A warning only writes a record and sends a message, so the bot's own
   * position is irrelevant to it and must not block recording one about a
   * senior member.
   */
  requiresDiscordAction: boolean;
}

/** Which rule refused, so a caller can word the refusal for where it is shown. */
export type HierarchyRule = "server-owner" | "actor-rank" | "bot-rank";

export type HierarchyResult =
  | { allowed: true }
  | { allowed: false; reason: string; rule: HierarchyRule };

export function checkHierarchy(check: HierarchyCheck): HierarchyResult {
  if (check.targetIsOwner) {
    return { allowed: false, reason: "The server owner cannot be actioned.", rule: "server-owner" };
  }

  if (!check.actorIsOwner && check.targetTopRole >= check.actorTopRole) {
    return {
      allowed: false,
      reason: "You cannot action someone with a role equal to or higher than your own.",
      rule: "actor-rank",
    };
  }

  // Applies even when the owner asked, because Discord enforces it against the
  // bot's roles regardless of who requested the action.
  if (check.requiresDiscordAction && check.targetTopRole >= check.botTopRole) {
    return {
      allowed: false,
      reason: "My highest role is not above theirs, so Discord won't let me do that.",
      rule: "bot-rank",
    };
  }

  return { allowed: true };
}

export interface StandingCheck {
  /** The acting staff member's place in the server, or null when they are not a member of it. */
  actor: { topRole: number; isServerOwner: boolean } | null;
  /**
   * The person running this TierZero install. They may act on a server they
   * have not joined, so they are trusted past the actor-versus-target
   * comparison, but never past the bot's own position or the server owner.
   */
  actorIsInstanceOwner: boolean;
  target: { topRole: number; isServerOwner: boolean };
  botTopRole: number;
  requiresDiscordAction: boolean;
}

export const NOT_IN_SERVER =
  "You need to be a member of this server to take moderation actions here, because the bot compares your roles with theirs.";

/**
 * The hierarchy rule for an action taken from the dashboard, where the person
 * acting may not be in the server at all. A member is weighed by their real
 * roles; the instance owner who is not a member is treated as the server
 * owner would be; anyone else who is not a member cannot be weighed and is
 * refused.
 */
export function checkStanding(check: StandingCheck): HierarchyResult {
  if (!check.actor && !check.actorIsInstanceOwner) {
    return { allowed: false, reason: NOT_IN_SERVER, rule: "actor-rank" };
  }
  return checkHierarchy({
    actorTopRole: check.actor?.topRole ?? 0,
    targetTopRole: check.target.topRole,
    botTopRole: check.botTopRole,
    targetIsOwner: check.target.isServerOwner,
    actorIsOwner: check.actor ? check.actor.isServerOwner : true,
    requiresDiscordAction: check.requiresDiscordAction,
  });
}
