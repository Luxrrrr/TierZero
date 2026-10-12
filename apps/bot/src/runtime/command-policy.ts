import type { MessageBody } from "@tier0/core";

/**
 * Who may run a command, and where. Kept free of runtime imports so the decision can
 * be exercised on its own, because getting it wrong either leaks a moderation
 * command to everyone or locks an operator out of their own server.
 *
 * Discord's own default_member_permissions covers what it can express, and is
 * preferred: it hides a command from the client, so nobody sees it and gets
 * turned away after trying. These are the rules it cannot express.
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

/** What an owner has changed about one command, beyond who may run it. */
export interface CommandSettings extends CommandPolicy {
  /** Null keeps whatever the command does by default. */
  ephemeral: boolean | null;
  /** Null keeps the command's own wording. */
  customReply: MessageBody | null;
  /** Discord permission bits, "everyone", or null for the command's default. */
  permissions: string | null;
}

export const EVERYONE = "everyone";

const ADMINISTRATOR = 8n;

/**
 * Whether an owner may set this as the permission needed to see a command.
 *
 * Discord hides a command from members who lack every bit in the value. A
 * command that already has a default (/ban needs Ban Members) may only be made
 * stricter: widening it to everyone would put a moderation command in front of
 * people the command itself never checks. Adding bits is stricter, and so is
 * Administrator, which anyone holding any permission set might still lack.
 */
export function permissionOverrideAllowed(value: string, commandDefault: string | null): boolean {
  if (value === EVERYONE) return commandDefault === null;
  if (!/^[0-9]+$/.test(value)) return false;
  const bits = BigInt(value);
  if (bits === 0n) return false;
  if (commandDefault === null) return true;
  const current = BigInt(commandDefault);
  return bits === ADMINISTRATOR || (bits & current) === current;
}
