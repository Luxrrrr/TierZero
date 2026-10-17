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
  /** The only channels it works in, when not empty. A category stands for every channel in it. */
  allowChannels?: string[];
}

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: "channel" | "role" };

/**
 * `parentIds` are what the channel sits in: the channel a thread belongs to and
 * the category above it. A rule on a channel covers its threads, and a rule on a
 * category covers every channel in it, which is how the dashboard's channel
 * picker offers them.
 */
export function checkCommandPolicy(
  policy: CommandPolicy,
  channelId: string | null,
  memberRoleIds: readonly string[],
  parentIds: readonly string[] = [],
): PolicyVerdict {
  if (channelId !== null) {
    const places = [channelId, ...parentIds];
    if (places.some((id) => policy.denyChannels.includes(id))) {
      return { allowed: false, reason: "channel" };
    }
    const allow = policy.allowChannels ?? [];
    if (allow.length > 0 && !places.some((id) => allow.includes(id))) {
      return { allowed: false, reason: "channel" };
    }
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

export interface ChannelRules {
  deny: string[];
  allow: string[];
}

/**
 * The channel rules share one column. A plain list is the deny list, which is
 * all older versions wrote; an allow list turns it into an object. Writing the
 * plain list whenever there is no allow list keeps a downgrade reading it.
 */
export function parseChannelRules(text: string): ChannelRules {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return { deny: ids(parsed), allow: [] };
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      return {
        deny: Array.isArray(record.deny) ? ids(record.deny) : [],
        allow: Array.isArray(record.allow) ? ids(record.allow) : [],
      };
    }
  } catch {
    // Falls through to no rules, as a damaged list always has.
  }
  return { deny: [], allow: [] };
}

export function serializeChannelRules(rules: ChannelRules): string {
  return rules.allow.length === 0 ? JSON.stringify(rules.deny) : JSON.stringify({ deny: rules.deny, allow: rules.allow });
}

const ids = (list: unknown[]): string[] => list.filter((id): id is string => typeof id === "string");

/** What an owner has changed about one command, beyond who may run it. */
export interface CommandSettings extends CommandPolicy {
  /**
   * False when the owner switched it off. A whole command that is off is never
   * registered, so this only decides anything for one part of a command, which
   * Discord shows whatever the bot says.
   */
  enabled: boolean;
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

interface NamedCommand {
  name: string;
  subcommands?: { key: string }[];
}

export type CommandTarget<C extends NamedCommand> =
  | { kind: "command"; command: C }
  | { kind: "part"; command: C; key: string };

/**
 * What an override key names: a whole command (right-click entries have spaces
 * in their names too, so those are matched first), or one part of a slash
 * command, stored under `command part` as Discord words it.
 */
export function resolveCommandKey<C extends NamedCommand>(commands: readonly C[], key: string): CommandTarget<C> | null {
  const whole = commands.find((command) => command.name === key);
  if (whole) return { kind: "command", command: whole };
  for (const command of commands) {
    if (command.subcommands?.some((part) => part.key === key)) return { kind: "part", command, key };
  }
  return null;
}

/** The settings that belong to a whole command, which one part of it cannot have on its own. */
const WHOLE_COMMAND_ONLY = ["permissions", "ephemeral", "customReply"] as const;

/** Why a change cannot be made to one part of a command, or null when it can. */
export function partPatchProblem(patch: Record<string, unknown>): string | null {
  const wrong = WHOLE_COMMAND_ONLY.filter((key) => patch[key] !== undefined);
  if (wrong.length === 0) return null;
  return "A part of a command can be switched off and limited to roles and channels. Who sees it in Discord and how it replies are set on the whole command.";
}
