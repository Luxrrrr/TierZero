/**
 * Finds where a typed search sits inside a name, the way the bot matched it:
 * case, accents, spaces and underscores do not count. The range is in the
 * original text, so it can be used to highlight what was typed.
 */

const IGNORED = /[\s_]/;

function folded(char: string): string {
  return char.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function flatten(text: string): { flat: string; starts: number[]; ends: number[] } {
  let flat = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const next = index + char.length;
    if (!IGNORED.test(char)) {
      for (const piece of folded(char)) {
        flat += piece;
        starts.push(index);
        ends.push(next);
      }
    }
    index = next;
  }
  return { flat, starts, ends };
}

export function matchRange(text: string, query: string): [number, number] | null {
  const needle = flatten(query.trim().replace(/^@/, "").replace(/#\d{4}$/, "")).flat;
  if (needle === "") return null;
  const { flat, starts, ends } = flatten(text);
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  return [starts[at]!, ends[at + needle.length - 1]!];
}

export interface NameParts {
  before: string;
  match: string;
  after: string;
}

export function splitMatch(text: string, query: string): NameParts {
  const range = matchRange(text, query);
  if (!range) return { before: text, match: "", after: "" };
  return { before: text.slice(0, range[0]), match: text.slice(range[0], range[1]), after: text.slice(range[1]) };
}
