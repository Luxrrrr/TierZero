/**
 * Role helpers shared by every module that hands roles out.
 *
 * Discord decides whether the bot may give or take a role by position, not by
 * permission: the role has to sit strictly below the bot's own highest role.
 * A module that skips the check gets a rejected API call and a log line for
 * something it could have known in advance, and the member is left wondering
 * why nothing happened.
 */

export function isRoleAssignable(rolePosition: number, botHighestPosition: number): boolean {
  return rolePosition < botHighestPosition;
}

interface SettingNode {
  kind: string;
  assigns?: unknown;
  fields?: unknown;
  of?: unknown;
}

/**
 * Every role a settings value hands out to members, by role id, with the path of
 * the setting that names it. These are the roles whose field says `assigns`, so a
 * role chosen only to exempt, limit or notify is not here. A list's own `assigns`
 * covers the roles inside it. Read from the module's described schema, which is
 * why a module needs no code of its own to be covered.
 */
export function assignedRoles(node: SettingNode, value: unknown, path = "", inherited = false): Map<string, string> {
  const found = new Map<string, string>();
  const assigns = inherited || node.assigns === true;

  if (node.kind === "role") {
    if (assigns && typeof value === "string" && value !== "") found.set(value, path);
    return found;
  }

  if (node.kind === "array" && Array.isArray(value) && typeof node.of === "object" && node.of !== null) {
    value.forEach((item, index) => {
      for (const [id, at] of assignedRoles(node.of as SettingNode, item, `${path}[${index}]`, assigns)) {
        if (!found.has(id)) found.set(id, at);
      }
    });
    return found;
  }

  if (node.kind === "object" && typeof node.fields === "object" && node.fields !== null && typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(node.fields as Record<string, SettingNode>)) {
      const own = Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
      for (const [id, at] of assignedRoles(child, own, path ? `${path}.${key}` : key)) {
        if (!found.has(id)) found.set(id, at);
      }
    }
  }
  return found;
}
