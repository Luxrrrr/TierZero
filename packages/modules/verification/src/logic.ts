import { randomBytes } from "node:crypto";
import { judge, minimumTime, type Round } from "./rounds.js";

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
  issuedAt: number;
  /** When the round the member is on was shown to them. */
  shownAt: number;
  /** Names the round on screen, so an answer given from an older message is not taken for this one. */
  nonce: string;
  /** The squares pressed so far in a tile round, from 1. */
  selected: number[];
  ttl: number;
  failures: number;
  lockedUntil: number;
}

export type CheckResult =
  | { outcome: "correct" }
  | { outcome: "next"; step: number; total: number }
  | { outcome: "wrong"; left: number }
  | { outcome: "exhausted" }
  | { outcome: "locked"; until: number }
  | { outcome: "expired" };

export interface Running {
  round: Round;
  step: number;
  total: number;
  nonce: string;
  selected: number[];
}

/** How typed answers are compared, which is the one thing about a round the settings decide. */
export interface Matchers {
  question(text: string): boolean;
}

const DAY = 86_400_000;
/** The longest a lockout is allowed to grow to, which is the longest the setting itself allows. */
export const LONGEST_LOCKOUT = 7 * DAY;
/** A lockout is doubled for each earlier one inside this long, up to this many doublings. */
const STRIKE_MEMORY = DAY;
const MAX_DOUBLINGS = 3;

/**
 * What each member is currently being asked, and how many times they have
 * missed. Held in memory on purpose: a restart costs a member one more press of
 * the button, and it keeps the answers out of the database.
 */
export class ChallengeBook {
  private readonly entries = new Map<string, Entry>();
  /** Lockouts a member has had lately, which make the next one longer. */
  private readonly strikes = new Map<string, { count: number; last: number }>();

  constructor(
    private readonly ttl = 5 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly newNonce: () => string = () => randomBytes(6).toString("hex"),
  ) {}

  /**
   * Starts a check. Misses already counted, and a lockout, carry over, so pressing again resets nothing.
   * The check may sit unanswered for `ttl`, where the book's own is too short.
   */
  issue(key: string, rounds: Round[], ttl = this.ttl): void {
    this.sweep();
    const previous = this.entries.get(key);
    const live = previous && this.fresh(previous) ? previous : undefined;
    const now = this.now();
    this.entries.set(key, {
      rounds,
      step: 0,
      issuedAt: now,
      shownAt: now,
      nonce: this.newNonce(),
      selected: [],
      ttl,
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
    return round ? { round, step: entry.step, total: entry.rounds.length, nonce: entry.nonce, selected: [...entry.selected] } : null;
  }

  /** The time a lockout ends, or null when the member is not locked out. */
  lockedUntil(key: string): number | null {
    const entry = this.entries.get(key);
    return entry && entry.lockedUntil > this.now() ? entry.lockedUntil : null;
  }

  /**
   * Locks a member out for `forMs`, or longer if they have been locked out
   * lately: twice as long the second time, four times the third, up to eight.
   */
  lock(key: string, forMs: number): number {
    const now = this.now();
    const earlier = this.strikes.get(key);
    const count = earlier && now - earlier.last < STRIKE_MEMORY ? earlier.count : 0;
    this.strikes.set(key, { count: count + 1, last: now });
    const until = now + Math.min(forMs * 2 ** Math.min(count, MAX_DOUBLINGS), Math.max(forMs, LONGEST_LOCKOUT));
    this.entries.set(key, { rounds: [], step: 0, issuedAt: 0, shownAt: 0, nonce: "", selected: [], ttl: this.ttl, failures: 0, lockedUntil: until });
    return until;
  }

  /**
   * Presses or unpresses a square of the tile round on screen, and gives the squares pressed now.
   * Null when no tile round is on screen, or the press came from a message that is no longer current.
   */
  toggle(key: string, nonce: string, square: number): number[] | null {
    const entry = this.entries.get(key);
    const running = this.running(key);
    if (!entry || !running || running.round.type !== "tiles" || nonce !== entry.nonce || !Number.isInteger(square) || square < 1 || square > 9) return null;
    entry.selected = entry.selected.includes(square) ? entry.selected.filter((pressed) => pressed !== square) : [...entry.selected, square];
    return [...entry.selected];
  }

  /** What the member has pressed in a tile round, in the form its answer is kept in. */
  selection(key: string): string {
    return [...(this.entries.get(key)?.selected ?? [])].sort((a, b) => a - b).join("");
  }

  /**
   * Judges what the member gave against the round they are on, and moves them along.
   * `nonce` is the one on the message the answer came from, when it came from one.
   */
  answer(key: string, text: string, maxAttempts: number, matchers: Matchers, nonce?: string): CheckResult {
    const locked = this.lockedUntil(key);
    if (locked !== null) return { outcome: "locked", until: locked };
    const entry = this.entries.get(key);
    const running = this.running(key);
    if (!entry || !running) return { outcome: "expired" };
    if (nonce !== undefined && nonce !== entry.nonce) return { outcome: "expired" };

    const verdict = judge(running.round, text, (round, given) =>
      round.type === "question" ? matchers.question(given) : matchesCaptcha(round.answer, given),
    );
    // Too quick to have been read and typed. It is counted as a miss without saying why, so it teaches nothing.
    const tooQuick = this.now() - entry.shownAt < minimumTime(running.round);

    if (verdict === "correct" && !tooQuick) {
      entry.step += 1;
      if (entry.step >= entry.rounds.length) {
        this.entries.delete(key);
        return { outcome: "correct" };
      }
      entry.shownAt = this.now();
      entry.nonce = this.newNonce();
      entry.selected = [];
      return { outcome: "next", step: entry.step, total: entry.rounds.length };
    }

    entry.failures += 1;
    if (entry.failures >= maxAttempts) {
      this.entries.delete(key);
      return { outcome: "exhausted" };
    }
    // A miss ends this attempt. The member starts over from the first round, with new ones.
    entry.rounds = [];
    entry.selected = [];
    return { outcome: "wrong", left: maxAttempts - entry.failures };
  }

  /** Drops what the member was being asked, but not a lockout or the lockouts they have had. */
  leave(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.lockedUntil <= this.now()) this.entries.delete(key);
  }

  /** Starts the member from nothing, as a moderator does by making them verify again, or as passing does. */
  clear(key: string): void {
    this.entries.delete(key);
    this.strikes.delete(key);
  }

  private fresh(entry: Entry): boolean {
    return entry.issuedAt !== 0 && this.now() - entry.issuedAt <= entry.ttl;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.issuedAt > entry.ttl) this.entries.delete(key);
    }
    for (const [key, strike] of this.strikes) if (now - strike.last >= STRIKE_MEMORY) this.strikes.delete(key);
  }
}
