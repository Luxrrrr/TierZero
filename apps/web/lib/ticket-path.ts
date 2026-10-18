/** A ticket page other than settings and setup, which are refused for a different reason (Manage Server). */
export function isTicketWorkspacePath(path: string): boolean {
  const match = /^\/guilds\/\d{17,20}\/tickets(\/[^?#]*)?/.exec(path);
  if (!match) return false;
  const rest = match[1] ?? "";
  return !/^\/(settings|setup)(\/|$)/.test(rest);
}
