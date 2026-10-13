import type { DeletionNote, DeletionSource } from "@tier0/core";

/** Who deleted a message, as the log keeps it. The id and name are those of the deleter at the time. */
export interface DeletionDecision {
  by: DeletionSource;
  byId: string | null;
  byName: string | null;
}

/** One line of Discord's audit log for a message deletion, reduced to what the decision reads. */
export interface AuditCandidate {
  id: string;
  executorId: string;
  executorName: string;
  /** The author of the deleted messages. */
  targetId: string | null;
  /** Only present when Discord says which channel the deletions were in. */
  channelId: string | null;
  /** How many messages Discord has folded into this line so far. */
  count: number;
  ageMs: number;
}

/** An audit line this young is taken to belong to a deletion that has just arrived. */
export const FRESH_MS = 15_000;

export interface DecideInput {
  note: DeletionNote | null;
  /** Newest first, as Discord returns them. Empty when the audit log could not be read. */
  candidates: readonly AuditCandidate[];
  /**
   * How many deletions each audit line has already been given to. Discord folds consecutive deletions
   * by one moderator into a single line whose count grows, so a line older than FRESH_MS can still be
   * the answer for a deletion if it has been given to fewer deletions than its count.
   */
  claims: ReadonlyMap<string, number>;
  authorId: string | null;
  authorName: string;
  channelId: string;
  botId: string;
  botName: string;
}

export interface Decision {
  source: DeletionDecision | null;
  /** The audit line the answer came from, so the caller can record that it was used. */
  claimed: AuditCandidate | null;
}

export function decisionFromNote(
  note: DeletionNote,
  who: { botId: string; botName: string; authorId: string | null; authorName: string },
): DeletionDecision {
  switch (note.by) {
    case "automod":
      return { by: "automod", byId: note.byId ?? who.botId, byName: note.byName ?? "Automod" };
    case "bot":
      return { by: "bot", byId: note.byId ?? who.botId, byName: note.byName ?? who.botName };
    case "author":
      return { by: "author", byId: note.byId ?? who.authorId, byName: note.byName ?? (who.authorId ? who.authorName : null) };
    case "moderator":
      return { by: "moderator", byId: note.byId ?? null, byName: note.byName ?? null };
  }
}

/**
 * Works out who deleted a message, in order of how much each source can be trusted:
 * a module that said so before it deleted; the server's audit log; and otherwise the author,
 * because deleting your own message leaves no audit line. A message whose author is not known
 * has no answer unless a module said so, since nothing can be matched.
 */
export function decideDeletion(input: DecideInput): Decision {
  if (input.note) return { source: decisionFromNote(input.note, input), claimed: null };
  if (input.authorId === null) return { source: null, claimed: null };

  const line = input.candidates.find((candidate) => {
    if (candidate.targetId !== input.authorId) return false;
    if (candidate.channelId !== null && candidate.channelId !== input.channelId) return false;
    const given = input.claims.get(candidate.id);
    return given === undefined ? candidate.ageMs <= FRESH_MS : candidate.count > given;
  });

  if (!line) {
    return { source: { by: "author", byId: input.authorId, byName: input.authorName }, claimed: null };
  }
  if (line.executorId === input.botId) {
    return { source: { by: "bot", byId: line.executorId, byName: input.botName }, claimed: line };
  }
  if (line.executorId === input.authorId) {
    return { source: { by: "author", byId: line.executorId, byName: line.executorName }, claimed: line };
  }
  return { source: { by: "moderator", byId: line.executorId, byName: line.executorName }, claimed: line };
}

/** The words for the summary of an entry, after "was deleted in #channel". Empty when the deleter is not known. */
export function deletedByPhrase(decision: DeletionDecision | null): string {
  if (!decision) return "";
  switch (decision.by) {
    case "author":
      return " by its author";
    case "automod":
      return " by Automod";
    default:
      return decision.byName ? ` by ${decision.byName}` : decision.by === "moderator" ? " by a moderator" : "";
  }
}

export const CLAIMS_LIMIT = 200;

/** Records that an audit line was given to one more deletion. Oldest lines are forgotten past a fixed size. */
export function recordClaim(claims: Map<string, number>, line: AuditCandidate): void {
  const next = (claims.get(line.id) ?? 0) + 1;
  claims.delete(line.id);
  claims.set(line.id, next);
  while (claims.size > CLAIMS_LIMIT) {
    const oldest = claims.keys().next().value;
    if (oldest === undefined) break;
    claims.delete(oldest);
  }
}
