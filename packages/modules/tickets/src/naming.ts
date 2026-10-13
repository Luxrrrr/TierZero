import { applyVariables } from "@tier0/core";

/** What the channel of a new ticket is called until the owner picks another pattern. */
export const DEFAULT_CHANNEL_NAME = "ticket-{username}";

/** Discord rejects names longer than 100 characters; this stays well under. */
const NAME_LIMIT = 90;

/**
 * Discord channel names are restricted to lowercase letters, digits, hyphens
 * and underscores, and capped well under the 100 characters a channel object
 * technically allows. Kept pure so the sanitising rule is testable without a
 * guild to create a channel in.
 */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fills the owner's pattern with the member's name, then holds the result to
 * the same rules as a name typed into Discord, because variables and the
 * pattern itself can both bring in characters a channel name may not have.
 */
export function ticketChannelName(username: string, pattern: string = DEFAULT_CHANNEL_NAME): string {
  const member = slugOf(username) || "member";
  const named = slugOf(applyVariables(pattern, { username: member }));
  return (named || `ticket-${member}`).slice(0, NAME_LIMIT);
}
