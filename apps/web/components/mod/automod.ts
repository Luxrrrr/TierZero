/**
 * How the dashboard reads the entries automod records. Each one has an action
 * starting with `automod-` and a reason of the form `<rule>: <detail>` or just
 * `<rule>`; there is no separate column for the rule, so it is parsed. The
 * parsing and the rule names live in @tier0/core so the bot's CSV export reads
 * them the same way. Pure, so server and client components and the tests can share it.
 */

import { automodDetailText, automodRuleLabel, parseAutomodReason, readableReason, type AutomodReason } from "@tier0/shared-moderation";

export { automodDetailText, parseAutomodReason, readableReason, type AutomodReason };

export const AUTOMOD_PREFIX = "automod-";

export function isAutomodAction(action: string): boolean {
  return action.startsWith(AUTOMOD_PREFIX);
}

/** A readable name for a rule, including ones this version has never heard of. */
export function ruleLabel(rule: string): string {
  return automodRuleLabel(rule);
}

const AUTOMOD_ACTION_LABEL: Record<string, string> = {
  "automod-warn": "Automod warn",
  "automod-timeout": "Automod timeout",
  "automod-delete": "Automod message delete",
};

/** The label for an automod action, falling back to a tidied form of an unrecognised `automod-` kind. */
export function automodActionLabel(action: string): string | null {
  if (!isAutomodAction(action)) return null;
  const known = AUTOMOD_ACTION_LABEL[action];
  if (known) return known;
  const kind = action.slice(AUTOMOD_PREFIX.length).replace(/[-_]+/g, " ").trim();
  return kind === "" ? "Automod" : `Automod ${kind}`;
}
