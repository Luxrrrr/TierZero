import type { AutocompleteInteraction, ChatInputCommandInteraction, User } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { ActionRefused } from "../action-rules.js";
import type { InfractionRecord } from "../infractions.js";
import type { ModerationAction } from "../modlog.js";
import { fetchMemberOrNull } from "../lookups.js";
import { performAction } from "../perform.js";
import { applyPreset, presetSuggestions } from "../presets.js";
import { replyRefusal } from "../reply.js";

export interface CommandAction {
  action: ModerationAction;
  target: User;
  durationMs?: number | null;
  unreadableDuration?: boolean;
  /** No length was typed, so a reason preset's own length may take the place of the default. */
  untypedDuration?: boolean;
}

/**
 * Hands a slash command to the shared performer and turns a refusal into the
 * ephemeral reply the command has always given. A reason that names one of the
 * server's presets is recorded as that preset's reason. Returns the stored
 * record, or null once a refusal has been sent.
 */
export async function runFromCommand(
  interaction: ChatInputCommandInteraction,
  ctx: ModuleContext<ModerationSettings>,
  request: CommandAction,
): Promise<InfractionRecord | null> {
  try {
    const chosen = applyPreset(interaction.options.getString("reason"), ctx.settings.reasonPresets, request.action);
    const durationMs = request.untypedDuration && chosen.durationMs !== null ? chosen.durationMs : (request.durationMs ?? null);
    // Needed for every action: their Discord permissions are checked, and for most their roles are weighed.
    const actorMember = await fetchMemberOrNull(ctx.guild, interaction.user.id);
    const { record } = await performAction(ctx, {
      action: request.action,
      targetId: request.target.id,
      targetName: request.target.username,
      moderatorId: interaction.user.id,
      reason: chosen.reason,
      durationMs,
      unreadableDuration: request.unreadableDuration,
      deleteDays: null,
      actorMember,
      actorIsInstanceOwner: false,
      origin: "command",
      audit: { actorName: interaction.user.username },
    });
    return record;
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    await replyRefusal(ctx, interaction, error);
    return null;
  }
}

/** Suggests the server's reason presets in the reason box of an action command. */
export async function suggestReasons(interaction: AutocompleteInteraction, ctx: ModuleContext<ModerationSettings>): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "reason") {
    await interaction.respond([]);
    return;
  }
  await interaction.respond(presetSuggestions(String(focused.value), ctx.settings.reasonPresets));
}
