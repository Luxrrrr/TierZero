import { applyVariables } from "@tier0/core";

/** What the channel of a new ticket is called until the owner picks another pattern. */
export const DEFAULT_CHANNEL_NAME = "ticket-{username}";

/** What a channel name pattern can fill in. */
export const CHANNEL_NAME_PLACEHOLDERS = ["username", "type", "number"];

/** What the dashboard's preview fills the pattern with. */
export const CHANNEL_NAME_SAMPLES = { username: "fragmuffin", type: "Support", number: "12" };

/** Discord rejects names longer than 100 characters; this stays well under. */
const NAME_LIMIT = 90;

/**
 * Discord channel names are lowercase letters of any alphabet, digits, hyphens
 * and underscores, and are capped well under the 100 characters a channel
 * object technically allows. Letters outside the Latin alphabet are kept, so a
 * member named in Cyrillic or Japanese gets a channel named after them. Kept
 * pure so the sanitising rule is testable without a guild to create a channel in.
 */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fills the owner's pattern with the member's name, then holds the result to
 * the same rules as a name typed into Discord, because variables and the
 * pattern itself can both bring in characters a channel name may not have.
 */
export function ticketChannelName(
  username: string,
  pattern: string = DEFAULT_CHANNEL_NAME,
  extra: { type?: string; number?: number | null } = {},
): string {
  const member = slugOf(username) || "member";
  const number = extra.number === undefined || extra.number === null ? "" : String(extra.number);
  const named = slugOf(applyVariables(pattern, { username: member, type: extra.type ?? "", number }));
  return (named || `ticket-${member}`).slice(0, NAME_LIMIT);
}
