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
