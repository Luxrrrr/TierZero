import type { FieldDescriptor, FormStep } from "@tier0/core";

/**
 * Sorts the settings of a group drawn with `steps` into its steps. A setting
 * names its step with `step`; one that names none, or names one the group does
 * not declare, goes in the first, so nothing is ever left off the page.
 * Settings the dashboard draws nothing for are skipped. Free of React so the
 * tests can import it directly.
 */

export interface StepGroup {
  step: FormStep;
  /** Keys of the group's settings, in schema order. */
  keys: string[];
}

/** The declared steps, or an empty list when the metadata is missing or malformed. */
export function declaredSteps(group: FieldDescriptor): FormStep[] {
  const steps = group.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter(
    (step): step is FormStep =>
      typeof step === "object" && step !== null && typeof (step as FormStep).id === "string" && typeof (step as FormStep).title === "string",
  );
}

export function stepGroups(fields: Record<string, FieldDescriptor>, steps: readonly FormStep[]): StepGroup[] {
  const first = steps[0];
  if (!first) return [];
  const groups: StepGroup[] = steps.map((step) => ({ step, keys: [] }));
  for (const [key, field] of Object.entries(fields)) {
    if (field.kind === "string" && field.generated === true) continue;
    const named = typeof field.step === "string" ? groups.find((group) => group.step.id === field.step) : undefined;
    (named ?? groups[0])?.keys.push(key);
  }
  return groups.filter((group) => group.keys.length > 0);
}
