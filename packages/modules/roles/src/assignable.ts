/**
 * A role above the bot's own highest role cannot be assigned by it. Discord
 * enforces this by position, not permission, so it has to be checked before
 * the API call rather than only handled as a failure afterwards.
 */
export function isAssignable(rolePosition: number, botHighestPosition: number): boolean {
  return rolePosition < botHighestPosition;
}
