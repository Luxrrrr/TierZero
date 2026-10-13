/**
 * The decisions around a message that need no Discord connection: whether to
 * look at it at all, what actually happened once a rule tripped, and what to
 * write down about it. index.ts feeds these from discord.js objects; keeping
 * them here is what lets the awkward cases be tested with plain values.
 */
import type { AutomodSettings } from "./settings.js";
import {
  evaluateMessage,
  fingerprintOf,
  type EvaluationVerdict,
  type RuleAction,
} from "./evaluator.js";
import { matchText } from "./messages.js";
import type { AutomodState } from "./state.js";
import { DEFAULT_AUTOMOD_WORDING, type AutomodWording } from "./texts.js";

export interface IncomingMessage {
  guildId: string;
  userId: string;
  messageId: string;
  content: string;
  /** True for an update to a message already seen, false for a new one. */
  isEdit: boolean;
  /**
   * What the message said before the edit. Null or undefined when Discord did
   * not have the old version cached, which is common, so it cannot be relied on.
   */
  previousContent?: string | null;
  authorRoles: string[];
  authorIsModerator: boolean;
  channelId: string;
  parentChannelId: string | null;
  now: number;
  settings: AutomodSettings;
}

/**
 * Returns the verdict for a message that tripped a rule, or null when there is
 * nothing to do: nothing tripped, or this exact message was already looked at.
 *
 * Discord sends an update when an embed finishes loading, when a message is
 * pinned and when its flags change, and none of those is something new to
 * judge. Edits are still read, because an edit is the obvious way past a filter
 * that only reads a message once, but only when the text changed, and an edit is
 * never counted as another message toward the rate limit or repeated text.
 */
export function judgeMessage(state: AutomodState, message: IncomingMessage): EvaluationVerdict | null {
  const fingerprint = fingerprintOf(message.content);

  if (message.isEdit) {
    if (message.previousContent === message.content) return null;
    if (state.wasHandled(message.messageId, fingerprint)) return null;
  }

  const history = message.isEdit
    ? []
    : state.recordAndGetHistory(message.guildId, message.userId, {
        fingerprint,
        timestamp: message.now,
      });
  state.markHandled(message.messageId, fingerprint);

  const verdict = evaluateMessage({
    content: message.content,
    authorRoles: message.authorRoles,
    authorIsBot: false,
    authorIsModerator: message.authorIsModerator,
    channelId: message.channelId,
    parentChannelId: message.parentChannelId,
    isEdit: message.isEdit,
    now: message.now,
    history,
    settings: message.settings,
  });
  return verdict.triggered && verdict.rule && verdict.actions?.length ? verdict : null;
}

// -- carrying the action out ------------------------------------------------

/** The two things a rule can ask Discord for. Each rejects when Discord refuses. */
export interface Steps {
  deleteMessage(): Promise<unknown>;
  timeoutMember(ms: number): Promise<unknown>;
}

export interface Outcome {
  /** The message is gone, whether this module removed it or someone beat it to it. */
  deleted: boolean;
  /** The rule asked for a warning. Recording it is what carries it out, so this cannot fail here. */
  warned: boolean;
  timedOut: boolean;
  /** Fixed wording for staff. Never quotes the message. */
  problems: string[];
}

// Discord's own numbers for "Unknown Message" and "Missing Permissions".
const UNKNOWN_MESSAGE = 10008;
const MISSING_PERMISSIONS = 50013;

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

export async function carryOut(
  actions: readonly RuleAction[],
  timeoutMs: number | undefined,
  steps: Steps,
  problems: AutomodWording["problems"] = DEFAULT_AUTOMOD_WORDING.problems,
): Promise<Outcome> {
  const outcome: Outcome = { deleted: false, warned: actions.includes("warn"), timedOut: false, problems: [] };

  if (actions.includes("delete")) {
    try {
      await steps.deleteMessage();
      outcome.deleted = true;
    } catch (error) {
      // The author or another handler got there first. The message is gone,
      // which is what was wanted.
      if (codeOf(error) === UNKNOWN_MESSAGE) {
        outcome.deleted = true;
      } else {
        outcome.problems.push(codeOf(error) === MISSING_PERMISSIONS ? problems.deleteMissingPermission : problems.deleteRefused);
      }
    }
  }

  if (actions.includes("timeout") && timeoutMs) {
    try {
      await steps.timeoutMember(timeoutMs);
      outcome.timedOut = true;
    } catch (error) {
      outcome.problems.push(codeOf(error) === MISSING_PERMISSIONS ? problems.timeoutMissingPermission : problems.timeoutRefused);
    }
  }

  return outcome;
}

// -- the record --------------------------------------------------------------

export interface InfractionDraft {
  action: string;
  reason: string;
  expiresAt: Date | null;
  active: boolean;
}

/** The strongest thing that really happened, which is what the case and the log post are filed under. */
export function strongestDone(done: Pick<Outcome, "deleted" | "warned" | "timedOut">): RuleAction {
  if (done.timedOut) return "timeout";
  if (done.warned) return "warn";
  // A rule that managed nothing at all is still on record as a warning.
  return done.deleted ? "delete" : "warn";
}

/**
 * What goes in the permanent record, from what happened. A timeout that was
 * refused is recorded as the warning or deletion that did happen, so the
 * member does not show as restricted when they are not. The match is kept here
 * because staff read this on the dashboard, in a code span so it stays inert.
 */
export function draftInfraction(
  verdict: Pick<EvaluationVerdict, "rule" | "reason" | "detail" | "matches">,
  outcome: Outcome,
  timeoutMs: number | undefined,
  now: number,
  wording: AutomodWording = DEFAULT_AUTOMOD_WORDING,
): InfractionDraft {
  const action = strongestDone(outcome);
  const rule = verdict.rule ?? "automod";
  let reason = verdict.reason ? `${rule}: ${verdict.reason}` : rule;
  const matched = matchText(verdict, wording);
  if (matched) reason += ` (matched ${matched})`;
  if (outcome.problems.length > 0) reason += ` (${outcome.problems.join("; ")})`;

  return {
    action: `automod-${action}`,
    reason,
    expiresAt: outcome.timedOut && timeoutMs ? new Date(now + timeoutMs) : null,
    active: outcome.timedOut,
  };
}

// -- the notice ----------------------------------------------------------------

/** The least a notice can be left up. The setting has no minimum of its own, so this keeps a typed 1s from flashing past unread. */
export const MIN_NOTICE_MS = 2_000;

/** How long to leave the notice in the channel, or null to leave it for good (a setting of zero). */
export function noticeLifetimeMs(setting: number): number | null {
  return setting <= 0 ? null : Math.max(MIN_NOTICE_MS, setting);
}
