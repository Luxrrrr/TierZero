import { PermissionFlagsBits, type Guild } from "discord.js";
import type { FieldError } from "@tier0/core";
import { isInstanceOwner } from "../instance-owner.js";

/**
 * A setting that hands a role to members is the same act as giving that role in
 * Discord, so it takes the same rights: Manage Roles, and a role above the one
 * being handed out. Manage Server alone lets someone configure the bot, and
 * without this it would also let them point a role button at any role below the
 * bot's own, an administrator role included.
 *
 * Only a role newly added to a setting is checked, so saving a page whose roles
 * were set by someone else changes nothing for the person saving it.
 */
export async function roleGrantProblems(
  guild: Guild,
  actorId: string | undefined,
  granted: ReadonlyMap<string, string>,
): Promise<FieldError[]> {
  if (granted.size === 0) return [];
  const refuse = (message: (roleId: string) => string): FieldError[] =>
    [...granted].map(([roleId, path]) => ({ path, message: message(roleId) }));

  if (!actorId) return refuse(() => "We couldn't tell who is saving this. Reload the page and try again.");
  if (guild.ownerId === actorId || (await isInstanceOwner(actorId))) return [];

  const member = await guild.members.fetch(actorId).catch(() => null);
  if (!member) return refuse(() => "Only a member of this server can hand out its roles.");
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return [];
  if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return refuse(() => "Handing out a role needs the Manage Roles permission in Discord, the same as giving it by hand.");
  }

  const problems: FieldError[] = [];
  for (const [roleId, path] of granted) {
    const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (role && role.position >= member.roles.highest.position) {
      problems.push({ path, message: `${role.name} is at or above your highest role, so you can't hand it out. Discord applies the same rule.` });
    }
  }
  return problems;
}
