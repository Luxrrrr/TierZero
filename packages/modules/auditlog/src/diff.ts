import type { AuditCategory } from "./policy.js";

export interface MemberSnapshot {
  nickname: string | null;
  roleIds: string[];
}

export interface MemberDiff {
  nicknameChanged: boolean;
  nicknameBefore: string | null;
  nicknameAfter: string | null;
  rolesAdded: string[];
  rolesRemoved: string[];
}

/** What actually changed between two versions of a member. */
export function diffMember(before: MemberSnapshot, after: MemberSnapshot): MemberDiff {
  const beforeRoles = new Set(before.roleIds);
  const afterRoles = new Set(after.roleIds);
  return {
    nicknameChanged: before.nickname !== after.nickname,
    nicknameBefore: before.nickname,
    nicknameAfter: after.nickname,
    rolesAdded: after.roleIds.filter((id) => !beforeRoles.has(id)),
    rolesRemoved: before.roleIds.filter((id) => !afterRoles.has(id)),
  };
}

/** Which of the settings categories a member diff actually touches. */
export function categoriesForMemberDiff(diff: MemberDiff): AuditCategory[] {
  const categories: AuditCategory[] = [];
  if (diff.nicknameChanged) categories.push("nicknameChange");
  if (diff.rolesAdded.length > 0 || diff.rolesRemoved.length > 0) categories.push("roleChange");
  return categories;
}

/**
 * Whether a member update put a timeout on, or took one off. Lengthening a
 * timeout counts as putting one on. A timeout that runs out on its own sends
 * no event, so it is never reported as lifted.
 */
export function timeoutChange(beforeUntil: number | null, afterUntil: number | null, now: number): "add" | "remove" | null {
  if (beforeUntil === afterUntil) return null;
  if (afterUntil !== null && afterUntil > now) return "add";
  if (beforeUntil !== null && beforeUntil > now) return "remove";
  return null;
}

/** What a voice state change was, by the channel before and after. Muting and the like change neither. */
export function voiceChange(fromId: string | null, toId: string | null): "join" | "leave" | "move" | null {
  if (!fromId && toId) return "join";
  if (fromId && !toId) return "leave";
  if (fromId && toId && fromId !== toId) return "move";
  return null;
}

export interface ServerSnapshot {
  name: string;
  description: string | null;
  icon: string | null;
  banner: string | null;
  verificationLevel: number;
  afkChannelId: string | null;
  afkTimeout: number;
  systemChannelId: string | null;
  rulesChannelId: string | null;
  ownerId: string;
}

const VERIFICATION = ["None", "Low", "Medium", "High", "Highest"];

const channel = (id: string | null): string => (id ? `<#${id}>` : "(none)");
const text = (value: string | null): string => (value && value.trim() !== "" ? value : "(none)");

/** One line per server setting that changed, such as "Name: Old Arcade to New Arcade". */
export function serverChanges(before: ServerSnapshot, after: ServerSnapshot): string[] {
  const lines: string[] = [];
  const add = (label: string, a: string, b: string) => {
    if (a !== b) lines.push(`${label}: ${a} to ${b}`);
  };
  add("Name", before.name, after.name);
  add("Description", text(before.description), text(after.description));
  // Pictures are compared by hash, which means nothing to a reader, so only the fact is shown.
  if (before.icon !== after.icon) lines.push(after.icon ? "Icon: changed" : "Icon: removed");
  if (before.banner !== after.banner) lines.push(after.banner ? "Banner: changed" : "Banner: removed");
  add("Verification level", VERIFICATION[before.verificationLevel] ?? String(before.verificationLevel), VERIFICATION[after.verificationLevel] ?? String(after.verificationLevel));
  add("Inactive channel", channel(before.afkChannelId), channel(after.afkChannelId));
  add("Inactive timeout", `${Math.round(before.afkTimeout / 60)} min`, `${Math.round(after.afkTimeout / 60)} min`);
  add("System messages channel", channel(before.systemChannelId), channel(after.systemChannelId));
  add("Rules channel", channel(before.rulesChannelId), channel(after.rulesChannelId));
  add("Owner", `<@${before.ownerId}>`, `<@${after.ownerId}>`);
  return lines;
}
