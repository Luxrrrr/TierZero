import { presetNamed, type ReasonPresetDto } from "@tier0/core";
import { MAX_TIMEOUT_MS } from "./duration.js";
import type { ModerationAction } from "./modlog.js";
import type { ReasonPreset } from "./settings.js";

/**
 * Reason presets, the way the Discord side uses them. The dashboard fills the
 * form from the list itself; here a preset arrives as its name, typed into the
 * reason box or picked from the autocomplete, and is turned into its reason.
 */

/** What the action form is sent, in the owner's order. */
export function presetDtos(presets: readonly ReasonPreset[]): ReasonPresetDto[] {
  return presets.map((preset) => ({ name: preset.name, reason: preset.reason, durationMs: preset.duration ?? null }));
}

/** A preset's length for this action, or null when it has none or it does not fit one. */
export function presetLength(preset: ReasonPreset | null, action: ModerationAction): number | null {
  if (!preset?.duration) return null;
  if (action === "timeout") return preset.duration <= MAX_TIMEOUT_MS ? preset.duration : null;
  return action === "ban" ? preset.duration : null;
}

export interface PresetChoice {
  reason: string | null;
  /** The preset's length, when the person gave none of their own. */
  durationMs: number | null;
}

/**
 * The reason to record for what was typed, and the length a named preset
 * brings with it. Anything that is not a preset's name is the reason as typed.
 */
export function applyPreset(typed: string | null, presets: readonly ReasonPreset[], action: ModerationAction): PresetChoice {
  const preset = presetNamed(typed, presets);
  if (!preset) return { reason: typed, durationMs: null };
  return { reason: preset.reason, durationMs: presetLength(preset, action) };
}

/** Discord shows at most 25 suggestions, and a suggestion's name and value can be at most 100 characters. */
const CHOICES_MAX = 25;
const CHOICE_TEXT_MAX = 100;

const clipChoice = (text: string): string => (text.length > CHOICE_TEXT_MAX ? `${text.slice(0, CHOICE_TEXT_MAX - 3)}...` : text);

/**
 * Suggestions for the reason box while it is typed in: the presets whose name
 * or reason contains what has been typed, then the typed text itself so it can
 * still be sent as written. The value is the preset's name, which the command
 * turns back into its reason.
 */
export function presetSuggestions(typed: string, presets: readonly ReasonPreset[]): { name: string; value: string }[] {
  const query = typed.trim().toLowerCase();
  const matching = presets.filter(
    (preset) => query === "" || preset.name.toLowerCase().includes(query) || preset.reason.toLowerCase().includes(query),
  );
  const choices = matching.map((preset) => ({ name: clipChoice(`${preset.name}: ${preset.reason}`), value: clipChoice(preset.name) }));
  const own = typed.trim();
  // The text as typed stays one pick away, unless it already is a preset's name. Longer text than a suggestion
  // can hold is still sent whole if the person just presses enter, so it is only offered when it fits.
  if (own !== "" && own.length <= CHOICE_TEXT_MAX && !presetNamed(own, presets)) choices.unshift({ name: own, value: own });
  return choices.slice(0, CHOICES_MAX);
}
