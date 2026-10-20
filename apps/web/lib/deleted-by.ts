import type { DeletionSource } from "@tier0/shared-moderation";

/**
 * What the red tag on a deleted message says. The name is the one saved when it
 * happened, so a moderator who has since left or renamed still reads right.
 */
export function deletedByLabel(by: DeletionSource | null | undefined, name?: string | null): string {
  switch (by) {
    case "automod":
      return "Deleted by Automod";
    case "author":
      return name ? `Deleted by ${name} (the author)` : "Deleted by the author";
    case "bot":
      return name ? `Deleted by ${name} (bot)` : "Deleted by the bot";
    case "moderator":
      return name ? `Deleted by ${name} (moderator)` : "Deleted by a moderator";
    default:
      return "Deleted";
  }
}

/** Longer words for the tag's hover text. */
export function deletedByTitle(by: DeletionSource | null | undefined): string {
  switch (by) {
    case "automod":
      return "Automod deleted this message because it broke a rule";
    case "author":
      return "The member deleted their own message";
    case "bot":
      return "The bot deleted this message";
    case "moderator":
      return "A moderator deleted this message in Discord";
    default:
      return "The member, or someone else, deleted this message in Discord. The log could not tell who";
  }
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What to show for a logged message with no text of its own: what it did carry,
 * and only when it carried nothing at all, that it was empty.
 */
export function noTextLabel(attachments: number, extras: string): string {
  const parts = [...(attachments > 0 ? [plural(attachments, "attachment")] : []), ...(extras ? [extras] : [])];
  return parts.length > 0 ? `No text, ${parts.join(", ")}` : "No text.";
}
