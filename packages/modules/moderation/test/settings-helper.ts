import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import moderation from "../dist/index.js";
import type { ModerationSettings } from "../dist/settings.js";

const registry = new ModuleRegistry();
registry.register(moderation);

/** The module's settings as the bot reads them, from whatever an owner has stored. Nothing stored means every default. */
export function moderationSettingsWith(stored: Record<string, unknown> = {}): ModerationSettings {
  const resolved = registry.resolveSettings("moderation", stored);
  assert.ok(resolved.ok, "settings should resolve");
  return resolved.value as ModerationSettings;
}
