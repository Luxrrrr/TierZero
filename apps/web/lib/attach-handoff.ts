import type { EvidenceMessage } from "@tier0/core";

/**
 * Hands messages picked in the message log to the action form on a member's
 * page. They travel in session storage rather than the address, since a list
 * of message ids would make an unreadable link. Storage can be blocked, and
 * the form works without it, so every call is allowed to fail quietly.
 */

const TTL_MS = 30 * 60 * 1000;
const key = (guildId: string, userId: string) => `tier0:attach:${guildId}:${userId}`;

export function saveAttach(guildId: string, userId: string, messages: EvidenceMessage[]): void {
  try {
    sessionStorage.setItem(key(guildId, userId), JSON.stringify({ at: Date.now(), messages }));
  } catch {
    // The form simply opens with nothing picked.
  }
}

export function readAttach(guildId: string, userId: string): EvidenceMessage[] {
  try {
    const raw = sessionStorage.getItem(key(guildId, userId));
    if (!raw) return [];
    const stored = JSON.parse(raw) as { at?: unknown; messages?: unknown };
    if (typeof stored.at !== "number" || Date.now() - stored.at > TTL_MS || !Array.isArray(stored.messages)) return [];
    return stored.messages.filter((m): m is EvidenceMessage => typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string");
  } catch {
    return [];
  }
}

export function clearAttach(guildId: string, userId: string): void {
  try {
    sessionStorage.removeItem(key(guildId, userId));
  } catch {
    // Nothing to clear.
  }
}
