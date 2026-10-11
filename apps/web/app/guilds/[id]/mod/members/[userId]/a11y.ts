/**
 * Wording and key handling for assistive technology on the member profile.
 * Pure so the rules can be tested without a browser.
 */

/** What a row is about, used to make every repeated control's name unique. */
export function infractionSubject(actionLabel: string, caseNumber: number): string {
  return `${actionLabel.toLowerCase()} case ${caseNumber}`;
}

export function noteSubject(authorName: string, dateText: string): string {
  return `note by ${authorName}, ${dateText}`;
}

export function changeSubject(actorName: string, dateText: string): string {
  return `change by ${actorName}, ${dateText}`;
}

/**
 * "Edit, note by Priya, Oct 9, 2026". The visible label comes first so speech
 * users can say what they see (WCAG 2.5.3), and the subject keeps each row's
 * button distinct from the next one's.
 */
export function controlName(visibleLabel: string, subject: string): string {
  return `${visibleLabel}, ${subject}`;
}

export function toggleName(expanded: boolean, subject: string): string {
  return `${expanded ? "Hide" : "Show"} details for ${subject}`;
}

interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Alt+N starts a note. A bare letter would fire for speech-input and
 * single-switch users who never meant it (WCAG 2.1.4), so a modifier is
 * required. The physical key is checked as well as the character because
 * Option+N on a Mac produces a dead key rather than "n".
 */
export function isComposerShortcut(event: KeyLike): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.code === "KeyN" || event.key === "n" || event.key === "N";
}

/** The sentence a failed change shows: what failed, then the server's reason when it gave one. */
export function failureText(failure: string, detail: string | null | undefined, status?: number): string {
  const reason = detail?.trim() || (status ? `The server answered ${status}.` : "");
  return reason ? `${failure}. ${reason}` : `${failure}.`;
}
