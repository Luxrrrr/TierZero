import { applyVariables } from "@tier0/core";

/**
 * Fills the `{name}` pieces of one of the owner's labels. Kept apart from
 * texts.ts so the rule evaluator, which has to stay cheap and free of Discord,
 * can word a reason without loading anything else.
 */
export const fill = (text: string, values: Record<string, string | number>): string =>
  applyVariables(text, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));
