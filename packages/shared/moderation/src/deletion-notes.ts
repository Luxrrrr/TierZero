/**
 * A module that is about to delete a message says so here first, so the
 * server log can tell who removed it when the deletion event arrives.
 * Discord's own audit log cannot: it records nothing for a bot's own deletes
 * that it can tie to a rule, and nothing at all for an author deleting their
 * own message.
 *
 * This is in-process state, not shared storage. The module and the server log
 * run in the same bot process, the note only has to survive the second or so
 * between the delete call and the gateway event, and losing every note on a
 * restart costs one entry its source. Notes are taken once and expire on
 * their own, and the store is bounded so a flood of deletes cannot grow it.
 */

export type DeletionSource = "author" | "moderator" | "automod" | "bot";

export interface DeletionNote {
  by: DeletionSource;
  byId?: string;
  byName?: string;
}

export const DELETION_NOTE_TTL_MS = 60_000;
export const DELETION_NOTE_LIMIT = 1000;

interface Held {
  note: DeletionNote;
  expiresAt: number;
}

const held = new Map<string, Held>();

function dropExpired(now: number): void {
  // Entries go in oldest first and share one lifetime, so the expired ones are all at the front.
  for (const [id, entry] of held) {
    if (entry.expiresAt > now) break;
    held.delete(id);
  }
}

export function noteDeletion(messageId: string, note: DeletionNote, now: number = Date.now()): void {
  dropExpired(now);
  // Re-noting moves the entry to the back so the order stays by expiry.
  held.delete(messageId);
  held.set(messageId, { note, expiresAt: now + DELETION_NOTE_TTL_MS });
  while (held.size > DELETION_NOTE_LIMIT) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
}

/** The note for this message, if one is still fresh. Taking it removes it. */
export function takeDeletionNote(messageId: string, now: number = Date.now()): DeletionNote | null {
  const entry = held.get(messageId);
  if (!entry) return null;
  held.delete(messageId);
  return entry.expiresAt > now ? entry.note : null;
}

/** For tests: forget everything. */
export function clearDeletionNotes(): void {
  held.clear();
}
