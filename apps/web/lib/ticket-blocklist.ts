/**
 * The members blocklist inside the tickets settings draft, read and written
 * without disturbing anything around it. Free of React so the tests can
 * import it.
 */

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The Discord user IDs under General, Blocklist, Blocked members, in their stored order, without repeats. */
export function blockedIds(settings: Record<string, unknown>): string[] {
  const members = record(record(settings.general).blocklist).members;
  if (!Array.isArray(members)) return [];
  return [...new Set(members.filter((id): id is string => typeof id === "string" && /^[0-9]{17,20}$/.test(id)))];
}

/** The draft with the blocked members replaced, everything else kept as it was. */
export function withBlocked(settings: Record<string, unknown>, ids: readonly string[]): Record<string, unknown> {
  const general = record(settings.general);
  const blocklist = record(general.blocklist);
  return { ...settings, general: { ...general, blocklist: { ...blocklist, members: [...new Set(ids)] } } };
}
