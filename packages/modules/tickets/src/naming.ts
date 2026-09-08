/**
 * Discord channel names are restricted to lowercase letters, digits, hyphens
 * and underscores, and capped well under the 100 characters a channel object
 * technically allows. Kept pure so the sanitising rule is testable without a
 * guild to create a channel in.
 */
export function ticketChannelName(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || "member";
  return `ticket-${base}`.slice(0, 90);
}
