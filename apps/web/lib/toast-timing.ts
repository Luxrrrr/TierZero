/**
 * How long a success toast stays up. Six seconds is the floor, so a short
 * message is not gone before someone who looked away comes back to it, and
 * longer text gets time in proportion to its length at a slow reading pace.
 * Errors have no lifetime: they stay until dismissed.
 */
export const TOAST_MIN_MS = 6000;
export const TOAST_MAX_MS = 15000;
const MS_PER_WORD = 300;
const WORDS_INCLUDED = 8;

export function toastLifetime(title: string, detail?: string): number {
  const words = `${title} ${detail ?? ""}`.trim().split(/\s+/u).filter(Boolean).length;
  const extra = Math.max(0, words - WORDS_INCLUDED) * MS_PER_WORD;
  return Math.min(TOAST_MAX_MS, TOAST_MIN_MS + extra);
}
