/**
 * The ids of messages this bot posted itself, kept for a short while.
 *
 * Modules are never told about the bot's own messages being created, and the
 * server log skips bot authors, so nothing knows what a notice said once it is
 * deleted. Automod's notice is posted and removed a few seconds later, and without
 * this it appears in the log as a deletion by nobody with "what it said was not
 * saved". A deleted message can arrive without its author, so this is the only
 * reliable way to tell it was ours.
 */
const KEPT = 500;
const ids = new Set<string>();

export function rememberOwnMessage(id: string): void {
  ids.add(id);
  // A Set iterates in insertion order, so the first entry is the oldest.
  if (ids.size > KEPT) {
    const oldest = ids.values().next().value;
    if (oldest !== undefined) ids.delete(oldest);
  }
}

/** True once, for a message the bot posted. The id is forgotten as it is checked. */
export function takeOwnMessage(id: string): boolean {
  return ids.delete(id);
}
