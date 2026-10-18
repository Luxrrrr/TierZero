import {
  can,
  permissionForAction,
  type ListedRole,
  type ModActionKind,
  type ModPermission,
  type StaffDto,
  type StaffRole,
} from "@tier0/core";

/**
 * What the access page needs that has no React in it: the wording for each
 * permission, the grouping of the matrix, and the checks on what the owner
 * types. The matrix itself is computed from can(), so the page cannot drift
 * from what the bot enforces.
 */

export const MATRIX_ROLES: StaffRole[] = ["mod", "admin", "owner"];

export const LISTED_ROLES: ListedRole[] = ["mod", "admin"];

/** One line per level, shown where the owner picks one and above the matrix. */
export const ROLE_SUMMARY: Record<StaffRole, string> = {
  mod: "Reads member records, writes notes, warns and times out members, and can take back a warn or timeout.",
  admin: "Everything a moderator can, plus kicking, banning and unbanning, managing other staff’s notes, restoring removed actions, reading the audit trail, deciding ban appeals and using the Raid tools.",
  owner: "Runs this TierZero install. Full access on every server, including purging records.",
};

export interface PermissionRow {
  permission: ModPermission;
  label: string;
}

export interface PermissionGroup {
  title: string;
  rows: PermissionRow[];
}

/** Clearing a timeout shares the timeout permission, so it is named on that row rather than given its own. */
const ACTION_ROWS: { kind: Exclude<ModActionKind, "timeout-clear">; label: string }[] = [
  { kind: "warn", label: "Warn a member" },
  { kind: "timeout", label: "Time out a member, or end a timeout early" },
  { kind: "kick", label: "Kick a member from the server" },
  { kind: "ban", label: "Ban a member, permanently or for a set time" },
  { kind: "unban", label: "Lift a ban" },
];

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: "Viewing",
    rows: [
      { permission: "view", label: "Open the mod dashboard and read member records" },
      { permission: "stats.view", label: "See moderation statistics" },
      { permission: "audit.view", label: "Read staff activity" },
      { permission: "messages.view", label: "Open the server logs (moderators need “Let moderators open the server logs” switched on in the Server logs settings)" },
      { permission: "messages.purge", label: "Delete the server logs" },
    ],
  },
  {
    title: "Notes",
    rows: [
      { permission: "note.add", label: "Write staff notes on a member" },
      { permission: "note.edit.any", label: "Edit notes written by other staff" },
      { permission: "note.delete.any", label: "Delete notes written by other staff" },
      { permission: "note.restore", label: "Bring back a deleted note" },
    ],
  },
  {
    title: "Taking action",
    // Each row names the permission the bot checks for that action, so the
    // table follows any change to who may take it.
    rows: ACTION_ROWS.map(({ kind, label }) => ({ permission: permissionForAction(kind), label })),
  },
  {
    title: "Removing from records",
    rows: [
      { permission: "infraction.edit", label: "Edit a case: the reason, length and attached messages (moderators: their own)" },
      { permission: "infraction.void", label: "Take a warn or timeout off a record" },
      { permission: "infraction.void.any-action", label: "Take a kick, ban or other action off a record" },
      { permission: "infraction.restore", label: "Put a removed action back on a record" },
    ],
  },
  {
    title: "Appeals and raids",
    rows: [
      { permission: "appeals.manage", label: "Read ban appeals and accept or deny them" },
      { permission: "raid.lockdown", label: "Lock and unlock channels" },
      { permission: "raid.mass", label: "Ban or kick many members at once from the Raid tools" },
    ],
  },
  {
    title: "Administration",
    rows: [
      { permission: "purge", label: "Permanently erase an action or note, with its history" },
      { permission: "staff.manage", label: "Choose who has access, and at what level" },
    ],
  },
];

export const PERMISSION_ROWS: PermissionRow[] = PERMISSION_GROUPS.flatMap((group) => group.rows);

export interface MatrixRow extends PermissionRow {
  /** In the order of MATRIX_ROLES. */
  allowed: boolean[];
}

export interface MatrixGroup {
  title: string;
  rows: MatrixRow[];
}

function withGrants(row: PermissionRow): MatrixRow {
  return { ...row, allowed: MATRIX_ROLES.map((role) => can(role, row.permission)) };
}

export function permissionMatrix(): MatrixRow[] {
  return PERMISSION_ROWS.map(withGrants);
}

export function matrixGroups(): MatrixGroup[] {
  return PERMISSION_GROUPS.map((group) => ({ title: group.title, rows: group.rows.map(withGrants) }));
}

/** How many of the listed permissions a level holds, for the "x of y" line on its card. */
export function grantCount(role: StaffRole): { granted: number; total: number } {
  const granted = PERMISSION_ROWS.filter((row) => can(role, row.permission)).length;
  return { granted, total: PERMISSION_ROWS.length };
}

export interface RoleTally {
  mod: number;
  admin: number;
  total: number;
}

export function tallyRoles(staff: StaffDto[]): RoleTally {
  let mod = 0;
  let admin = 0;
  for (const member of staff) {
    if (member.role === "admin") admin += 1;
    else mod += 1;
  }
  return { mod, admin, total: staff.length };
}

/** Admins first, then by when they were added, so the list reads as seniority. */
export function sortStaff(staff: StaffDto[]): StaffDto[] {
  const rank = (role: ListedRole) => (role === "admin" ? 0 : 1);
  return [...staff].sort(
    (a, b) =>
      rank(a.role) - rank(b.role) ||
      a.addedAt.localeCompare(b.addedAt) ||
      a.user.userId.localeCompare(b.user.userId),
  );
}

export function pluralPeople(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

const SNOWFLAKE = /^\d{17,20}$/;

export function isSnowflake(value: string): boolean {
  return SNOWFLAKE.test(value.trim());
}

/** Why a pasted id was refused, or null when it is usable. */
export function userIdProblem(value: string): string | null {
  const text = value.trim();
  if (text === "") return "Paste a Discord user id.";
  if (/^<@!?\d+>$/.test(text)) return "Paste the number itself, without the surrounding mention.";
  if (!/^\d+$/.test(text)) return "A user id is digits only.";
  if (!SNOWFLAKE.test(text)) return "A user id is 17 to 20 digits long.";
  return null;
}

/**
 * Whether the add form can be submitted, and if not, the sentence that says
 * why. Null reason with ok false means "nothing chosen yet", which needs no
 * message.
 */
export function addState(
  targetId: string | null,
  existing: ReadonlySet<string>,
): { ok: boolean; reason: string | null } {
  if (targetId === null) return { ok: false, reason: null };
  if (existing.has(targetId)) return { ok: false, reason: "They already have access. Change their level in the list above." };
  return { ok: true, reason: null };
}

/** Permissions a person gains moving from one level to another, in the wording of the matrix. */
export function gainedPermissions(from: ListedRole, to: ListedRole): string[] {
  return PERMISSION_ROWS.filter((row) => can(to, row.permission) && !can(from, row.permission)).map((row) => row.label);
}

/** Raising someone to admin is the one change that widens what they can do to other staff’s records, so it asks first. */
export function needsConfirmation(from: ListedRole, to: ListedRole): boolean {
  return gainedPermissions(from, to).length > 0;
}

/** The consequence of removing someone, in the words shown beside the confirm button. */
export function removalConsequence(role: ListedRole): string {
  const { granted } = grantCount(role);
  return `They lose all ${granted} permissions of the ${role === "admin" ? "admin" : "moderator"} level and can no longer open the mod dashboard here. Notes and actions they recorded stay on file, and the change is written to the audit trail.`;
}
