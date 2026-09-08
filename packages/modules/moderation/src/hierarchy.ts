/**
 * Whether a moderation action may go ahead, given nothing but role positions.
 * Kept free of discord.js so this - the highest-risk decision in the module -
 * can be exercised without a guild, a member, or a gateway connection.
 *
 * Position comparisons use ">=" rather than ">", matching how Discord itself
 * enforces role hierarchy: a role does not outrank one sitting at the same
 * position, so equal footing is refused rather than allowed.
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

export type HierarchyResult = { allowed: true } | { allowed: false; reason: string };

export function checkHierarchy(check: HierarchyCheck): HierarchyResult {
  if (check.targetIsOwner) {
    return { allowed: false, reason: "The server owner cannot be actioned." };
  }

  if (!check.actorIsOwner && check.targetTopRole >= check.actorTopRole) {
    return {
      allowed: false,
      reason: "You cannot action someone with a role equal to or higher than your own.",
    };
  }

  // Applies even when the owner asked, because Discord enforces it against the
  // bot's roles regardless of who requested the action.
  if (check.requiresDiscordAction && check.targetTopRole >= check.botTopRole) {
    return {
      allowed: false,
      reason: "My highest role is not above theirs, so Discord won't let me do that.",
    };
  }

  return { allowed: true };
}
