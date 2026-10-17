/**
 * Banned-word patterns an owner writes: wildcards in the word list and regular
 * expressions in a list of their own. JavaScript's regular expressions can take
 * exponential time on some patterns, and one stuck match would stall the whole
 * bot, since every message in every server goes through here. So a pattern is
 * held to a shape whose worst case is bounded before it is ever run: no nested
 * repetition, no backreferences or lookarounds, every repeat capped, and only a
 * few repeats in all. The text it is tried on is capped too, and a pattern that
 * still runs slowly is set aside for a while.
 */

/** The longest pattern an owner can write. */
export const PATTERN_MAX_LENGTH = 200;
/** How many characters an open-ended repeat (`*`, `+`, `{2,}`) may cover. */
export const REPEAT_CAP = 32;
/** The most a bounded repeat may say, as in `{1,100}`. */
const BOUNDED_MAX = 100;
/** The product of every repeat's upper bound: what keeps the worst case linear in the text with a known factor. */
const WORK_CAP = 1 << 12;
/** How much of a message the patterns are tried on. */
export const PATTERN_TEXT_MAX = 2000;
/** The most wildcards one banned word may hold. */
export const WILDCARD_MAX = 2;

export type PatternCheck = { ok: true; source: string } | { ok: false; problem: string };

interface Frame {
  repeats: boolean;
  alternates: boolean;
  /** Holds something optional, such as a?, which gives a repeat of the group several ways to match the same text. */
  optional: boolean;
}

/**
 * Checks a pattern and returns the form that is run: the same pattern with
 * every open-ended repeat capped. The problem is worded for the owner, who sees
 * it under the setting when saving.
 */
export function checkPattern(pattern: string): PatternCheck {
  const raw = pattern.trim();
  if (raw === "") return { ok: false, problem: "is empty" };
  if (raw.length > PATTERN_MAX_LENGTH) return { ok: false, problem: `must be at most ${PATTERN_MAX_LENGTH} characters` };
  try {
    new RegExp(raw, "iu");
  } catch {
    return { ok: false, problem: "is not a valid regular expression" };
  }

  const frames: Frame[] = [{ repeats: false, alternates: false, optional: false }];
  let out = "";
  let work = 1;
  let inClass = false;
  // What the last group to close held, so a repeat right after it can be judged.
  let closed: Frame | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    const top = frames[frames.length - 1]!;

    if (ch === "\\") {
      const next = raw[i + 1] ?? "";
      if (/[1-9]/.test(next) || (next === "k" && raw[i + 2] === "<")) return { ok: false, problem: "cannot refer back to an earlier group" };
      out += ch + next;
      i += 1;
      closed = null;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      out += ch;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      out += ch;
      closed = null;
      continue;
    }
    if (ch === "(") {
      if (raw.startsWith("(?=", i) || raw.startsWith("(?!", i) || raw.startsWith("(?<=", i) || raw.startsWith("(?<!", i)) {
        return { ok: false, problem: "cannot use lookahead or lookbehind" };
      }
      frames.push({ repeats: false, alternates: false, optional: false });
      out += ch;
      closed = null;
      continue;
    }
    if (ch === ")") {
      const frame = frames.pop()!;
      const parent = frames[frames.length - 1]!;
      // What a group holds counts for every group around it, so ((a|a)c)* is caught as well as (a|a)*.
      if (frame.repeats) parent.repeats = true;
      if (frame.alternates) parent.alternates = true;
      if (frame.optional) parent.optional = true;
      out += ch;
      closed = frame;
      continue;
    }
    if (ch === "|") {
      top.alternates = true;
      out += ch;
      closed = null;
      continue;
    }

    const quantifier = readQuantifier(raw, i);
    if (quantifier) {
      // A repeat of a group that itself repeats or chooses between ways of matching is what can take
      // exponential time, as in (a+)+ or (a|aa)*. An optional group, (...)?, is fine.
      if (closed && (closed.repeats || closed.alternates || closed.optional) && quantifier.max !== 1) {
        return { ok: false, problem: "cannot repeat a group that repeats, is optional or has alternatives inside it, as in (a+)+ or (a?b?)+" };
      }
      if (quantifier.max !== null && quantifier.max > BOUNDED_MAX) return { ok: false, problem: `cannot repeat anything more than ${BOUNDED_MAX} times` };
      const max = quantifier.max ?? Math.max(quantifier.min, REPEAT_CAP);
      if (max > 1) {
        top.repeats = true;
        work *= max;
      } else if (quantifier.min === 0) {
        // Each optional piece doubles the ways a run of them can match, as in a?a?a?a?aaaa.
        top.optional = true;
        work *= 2;
      }
      if (work > WORK_CAP) return { ok: false, problem: "repeats too much in one pattern. Use fewer *, +, ? or {} repeats" };
      out += quantifier.max === null ? `{${quantifier.min},${max}}` : quantifier.text;
      // A lazy marker belongs to the repeat just written.
      i += quantifier.text.length - 1;
      if (raw[i + 1] === "?") {
        out += "?";
        i += 1;
      }
      closed = null;
      continue;
    }

    out += ch;
    closed = null;
  }

  try {
    new RegExp(out, "iu");
  } catch {
    return { ok: false, problem: "is not a valid regular expression" };
  }
  return { ok: true, source: out };
}

interface Quantifier {
  text: string;
  min: number;
  /** Null for an open-ended repeat. */
  max: number | null;
}

function readQuantifier(raw: string, i: number): Quantifier | null {
  const ch = raw[i];
  if (ch === "*") return { text: "*", min: 0, max: null };
  if (ch === "+") return { text: "+", min: 1, max: null };
  if (ch === "?") return { text: "?", min: 0, max: 1 };
  if (ch !== "{") return null;
  const match = /^\{(\d+)(,(\d*))?\}/.exec(raw.slice(i));
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : match[3] === "" ? null : Number(match[3]);
  return { text: match[0], min, max };
}

/** The message to show for a pattern that will not be used, or null when it is fine. */
export function patternProblem(pattern: string): string | null {
  const check = checkPattern(pattern);
  return check.ok ? null : check.problem;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A banned word with `*` in it, as the pattern it stands for: each `*` covers
 * any run of up to 32 characters that are not spaces, so `free*nitro` catches
 * freenitro and free-nitro but not two words far apart. Null when the word is
 * to be matched as written: it has no wildcard, more than two, or nothing but.
 */
export function wildcardSource(word: string): string | null {
  const stars = (word.match(/\*/g) ?? []).length;
  if (stars === 0 || stars > WILDCARD_MAX || word.replace(/\*/g, "").trim() === "") return null;
  return word.split("*").map(escapeRegExp).join(`[^\\s]{0,${REPEAT_CAP}}?`);
}

/** How long one pattern may take on one message before it is set aside. */
const SLOW_MS = 50;
/** How long a slow pattern is set aside for. */
const SET_ASIDE_MS = 60 * 60_000;

/**
 * Patterns that ran slowly, kept out of use for an hour in the server they ran
 * in. The shape check bounds the worst case; this catches what is merely slow.
 */
export class PatternGuard {
  private readonly aside = new Map<string, number>();

  constructor(private readonly clock: () => number = () => performance.now(), private readonly wall: () => number = () => Date.now()) {}

  /** Runs `test`, unless the pattern is set aside. A run that takes too long sets it aside. */
  run(guildId: string, source: string, test: () => boolean): boolean {
    const key = `${guildId}\u0000${source}`;
    const until = this.aside.get(key);
    if (until !== undefined) {
      if (this.wall() < until) return false;
      this.aside.delete(key);
    }
    const started = this.clock();
    const hit = test();
    const took = this.clock() - started;
    if (took > SLOW_MS) {
      this.aside.set(key, this.wall() + SET_ASIDE_MS);
      console.warn(`[automod] a banned-word pattern took ${Math.round(took)} ms in guild ${guildId} and is set aside for an hour. Simplify it in the Automod settings.`);
    }
    return hit;
  }

  isSetAside(guildId: string, source: string): boolean {
    const until = this.aside.get(`${guildId}\u0000${source}`);
    return until !== undefined && this.wall() < until;
  }
}
