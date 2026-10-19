import { judge, type Given, type Round } from "./rounds.js";

/**
 * The decisions verification makes, kept free of discord.js so they can be
 * tested without a client or a guild.
 */

/** What two answers are compared as: no case, no accents, no stray spaces. */
export function normalise(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A typed captcha answer: spaces are ignored, so "1 2" and "12" are the same. */
export function matchesCaptcha(expected: string, given: string): boolean {
  return normalise(expected) === normalise(given).replace(/ /g, "");
}

export function matchesAnswer(given: string, accepted: readonly string[]): boolean {
  const answer = normalise(given);
  if (answer === "") return false;
  return accepted.some((candidate) => normalise(candidate) === answer);
}

/** A question needs its text and at least one answer that is not blank. */
export function questionReady(question: string, answers: readonly string[]): boolean {
  return question.trim() !== "" && answers.some((answer) => answer.trim() !== "");
}

export type AgeDecision = { kind: "ok" } | { kind: "hold" | "kick"; oldEnoughAt: number };

/** Whether an account is old enough, and what to do about one that is not. */
export function accountAge(
  createdAt: number,
  now: number,
  minAge: number | undefined,
  action: string,
): AgeDecision {
  if (minAge === undefined || minAge <= 0) return { kind: "ok" };
  const oldEnoughAt = createdAt + minAge;
  return now >= oldEnoughAt ? { kind: "ok" } : { kind: action === "kick" ? "kick" : "hold", oldEnoughAt };
}

/** When to kick a member who has not verified, or null when nobody is kicked for waiting. */
export function timeoutDelay(action: string, timeout: number): number | null {
  return action === "kick" && timeout > 0 ? timeout : null;
}

export type PressOutcome = "notSetUp" | "alreadyVerified" | "tooYoung" | "locked" | "pass" | "challenge";

/** What pressing the verify button does, before any role is touched. */
export function pressOutcome(facts: {
  configured: boolean;
  verified: boolean;
  tooYoung: boolean;
  locked: boolean;
  method: string;
}): PressOutcome {
  if (!facts.configured) return "notSetUp";
  if (facts.verified) return "alreadyVerified";
  if (facts.tooYoung) return "tooYoung";
  if (facts.locked) return "locked";
  return facts.method === "button" ? "pass" : "challenge";
}

interface Entry {
  rounds: Round[];
  step: number;
  /** Tokens pressed so far in an order round. */
  pressed: string[];
  issuedAt: number;
  failures: number;
  lockedUntil: number;
}

export type CheckResult =
  | { outcome: "correct" }
  | { outcome: "next"; step: number; total: number }
  | { outcome: "more"; pressed: string[] }
  | { outcome: "wrong"; left: number }
  | { outcome: "exhausted" }
  | { outcome: "locked"; until: number }
  | { outcome: "expired" };

export interface Running {
  round: Round;
  step: number;
  total: number;
  pressed: string[];
}

/** How typed answers are compared, which is the one thing about a round the settings decide. */
export interface Matchers {
  question(text: string): boolean;
}

/**
 * What each member is currently being asked, and how many times they have
 * missed. Held in memory on purpose: a restart costs a member one more press of
 * the button, and it keeps the answers out of the database.
 */
export class ChallengeBook {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttl = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a check. Misses already counted, and a lockout, carry over, so pressing again resets nothing. */
  issue(key: string, rounds: Round[]): void {
    this.sweep();
    const previous = this.entries.get(key);
    const live = previous && this.fresh(previous) ? previous : undefined;
    this.entries.set(key, {
      rounds,
      step: 0,
      pressed: [],
      issuedAt: this.now(),
      failures: live?.failures ?? 0,
      lockedUntil: previous?.lockedUntil ?? 0,
    });
  }

  /** Whether the member has a check running that has not run out. */
  active(key: string): boolean {
    return this.running(key) !== null;
  }

  /** The round the member is on, or null when none is running. */
  running(key: string): Running | null {
    const entry = this.entries.get(key);
    if (!entry || !this.fresh(entry) || entry.rounds.length === 0) return null;
    const round = entry.rounds[entry.step];
    return round ? { round, step: entry.step, total: entry.rounds.length, pressed: [...entry.pressed] } : null;
  }

  /** The time a lockout ends, or null when the member is not locked out. */
  lockedUntil(key: string): number | null {
    const entry = this.entries.get(key);
    return entry && entry.lockedUntil > this.now() ? entry.lockedUntil : null;
  }

  lock(key: string, forMs: number): number {
    const until = this.now() + forMs;
    this.entries.set(key, { rounds: [], step: 0, pressed: [], issuedAt: 0, failures: 0, lockedUntil: until });
    return until;
  }

  /** Judges what the member gave against the round they are on, and moves them along. */
  answer(key: string, given: Given, maxAttempts: number, matchers: Matchers): CheckResult {
    const locked = this.lockedUntil(key);
    if (locked !== null) return { outcome: "locked", until: locked };
    const entry = this.entries.get(key);
    const running = this.running(key);
    if (!entry || !running) return { outcome: "expired" };

    const verdict = judge(running.round, entry.pressed, given, (round, text) =>
      round.type === "question" ? matchers.question(text) : matchesCaptcha(round.answer, text),
    );

    if (verdict === "more") {
      if (given.kind === "token" && !entry.pressed.includes(given.token)) entry.pressed.push(given.token);
      return { outcome: "more", pressed: [...entry.pressed] };
    }
    if (verdict === "correct") {
      entry.pressed = [];
      entry.step += 1;
      if (entry.step >= entry.rounds.length) {
        this.entries.delete(key);
        return { outcome: "correct" };
      }
      return { outcome: "next", step: entry.step, total: entry.rounds.length };
    }

    entry.failures += 1;
    if (entry.failures >= maxAttempts) {
      this.entries.delete(key);
      return { outcome: "exhausted" };
    }
    // A miss ends this attempt. The member starts over from the first round, with new ones.
    entry.rounds = [];
    entry.pressed = [];
    return { outcome: "wrong", left: maxAttempts - entry.failures };
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private fresh(entry: Entry): boolean {
    return entry.issuedAt !== 0 && this.now() - entry.issuedAt <= this.ttl;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.issuedAt > this.ttl) this.entries.delete(key);
    }
  }
}
