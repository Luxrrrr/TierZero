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
