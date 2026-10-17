/**
 * The bot words a refused setting as the end of a sentence about it ("must be
 * at least 1", "is required"), which is what a log line or a test wants. Under
 * a field on screen it reads as a sentence of its own: "This must be at least
 * 1." A message that is already a sentence is left as it is, apart from its
 * full stop.
 *
 * Kept free of anything that needs a bundler so the tests can import it.
 */
export function errorSentence(message: string): string {
  const text = message.trim();
  if (text === "") return text;
  const sentence = /^[a-z]/.test(text) ? `This ${text}` : text;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Field errors are the bot's verdict on the draft it was sent. Once the value
 * at a path is no longer what was sent, that verdict is about something else,
 * so it goes; the rest stay until the next save.
 */
export function errorsStillValid(
  errors: Readonly<Record<string, string>>,
  sent: unknown,
  draft: unknown,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (sameJson(valueAt(sent, path), valueAt(draft, path))) kept[path] = message;
  }
  return kept;
}

/** The value at a dotted, indexed path such as `rewards[2].role`. */
export function valueAt(root: unknown, path: string): unknown {
  if (path === "") return root;
  let current: unknown = root;
  for (const segment of path.split(/\.|\[(\d+)\]/).filter((part) => part !== undefined && part !== "")) {
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current) ? current[Number(segment)] : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
