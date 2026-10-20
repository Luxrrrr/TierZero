import { MOD_ACTION_KINDS, type ModActionKind } from "@tier0/shared-moderation";
import { needsMember, targetIdentityCode } from "./action-rules.js";
import { checkStanding, type HierarchyRule } from "./hierarchy.js";

/**
 * Which actions the dashboard's Take action menu should grey out for one
 * target, and why, in a few words. It is built from the same rules
 * `performAction` refuses with (identity, the actor's place in the server,
 * the role hierarchy and what Discord itself allows), so the menu never offers
 * something the bot would turn down. Free of discord.js so it can be tested
 * with plain numbers.
 */

export interface AvailabilityInput {
  targetId: string;
  actorId: string;
  botId: string | null;
  ownerId: string | null;
  /** The person asking, as a member of the server, or null when they are not one. */
  actor: { topRole: number; isServerOwner: boolean } | null;
  actorIsInstanceOwner: boolean;
  /** The target as a member of the server, or null when they are not in it. */
  target: { topRole: number; moderatable: boolean; kickable: boolean; bannable: boolean } | null;
  botTopRole: number;
}

export const BLOCKED_TEXT = {
  targetSelf: "You can't take action on yourself",
  targetBot: "This is the bot's own account",
  targetOwner: "The server owner can't be actioned",
  notInServer: "You need to be in this server to act on its members",
  actorRank: "Their top role is level with or above yours",
  botRank: "Their top role is level with or above the bot's",
  cannotActOn: "Discord won't let the bot do this to them. It may lack the permission, or they are an administrator",
  away: "Not possible while they are out of the server",
} as const;

const RULE_TEXT: Record<HierarchyRule, string> = {
  "server-owner": BLOCKED_TEXT.targetOwner,
  "actor-rank": BLOCKED_TEXT.actorRank,
  "bot-rank": BLOCKED_TEXT.botRank,
};

/** Discord's own check for each action that changes the member, which `performAction` runs before messaging them. */
const DISCORD_ALLOWS: Partial<Record<ModActionKind, "moderatable" | "kickable" | "bannable">> = {
  timeout: "moderatable",
  kick: "kickable",
  ban: "bannable",
};

/** The reason each action cannot be taken on this target, for the actions that cannot. The rest are left out. */
export function blockedActions(input: AvailabilityInput): Partial<Record<ModActionKind, string>> {
  const blocked: Partial<Record<ModActionKind, string>> = {};
  const identity = targetIdentityCode(input.targetId, input.actorId, input.botId, input.ownerId);
  const outside = !input.actor && !input.actorIsInstanceOwner;

  for (const kind of MOD_ACTION_KINDS) {
    if (identity) {
      blocked[kind] = BLOCKED_TEXT[identity];
      continue;
    }
    if (outside) {
      blocked[kind] = BLOCKED_TEXT.notInServer;
      continue;
    }
    const target = input.target;
    if (!target) {
      if (needsMember(kind, "dashboard")) blocked[kind] = BLOCKED_TEXT.away;
      continue;
    }
    // An unban has no member to weigh: someone banned is not in the server.
    if (kind === "unban") continue;
    const standing = checkStanding({
      actor: input.actor,
      actorIsInstanceOwner: input.actorIsInstanceOwner,
      target: { topRole: target.topRole, isServerOwner: false },
      botTopRole: input.botTopRole,
      requiresDiscordAction: kind !== "warn",
    });
    if (!standing.allowed) {
      blocked[kind] = standing.code === "notInServer" ? BLOCKED_TEXT.notInServer : RULE_TEXT[standing.rule];
      continue;
    }
    const check = DISCORD_ALLOWS[kind];
    if (check && !target[check]) blocked[kind] = BLOCKED_TEXT.cannotActOn;
  }
  return blocked;
}
