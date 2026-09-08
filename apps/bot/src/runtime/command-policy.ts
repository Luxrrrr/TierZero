/**
 * Who may run a command, and where. Kept free of imports so the decision can
 * be exercised on its own, because getting it wrong either leaks a moderation
 * command to everyone or locks an operator out of their own server.
 *
 * Discord's own default_member_permissions covers what it can express, and is
 * preferred because it hides a command in the client rather than rejecting it
 * after the fact. These are the rules it cannot express.
 */

export interface CommandPolicy {
  /** Roles allowed to run it. Empty means everyone. */
  allowRoles: string[];
  /** Channels it is refused in. Empty means everywhere. */
  denyChannels: string[];
}

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: "channel" | "role" };

export function checkCommandPolicy(
  policy: CommandPolicy,
  channelId: string | null,
  memberRoleIds: readonly string[],
): PolicyVerdict {
  if (channelId !== null && policy.denyChannels.includes(channelId)) {
    return { allowed: false, reason: "channel" };
  }

  if (policy.allowRoles.length > 0) {
    const permitted = policy.allowRoles.some((role) => memberRoleIds.includes(role));
    if (!permitted) return { allowed: false, reason: "role" };
  }

  return { allowed: true };
}

/** Stored as JSON text, and a damaged value must not widen access. */
export function parseIdList(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
