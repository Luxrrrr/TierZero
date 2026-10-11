import type { ChatInputCommandInteraction, User } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { ActionRefused } from "../action-rules.js";
import type { InfractionRecord } from "../infractions.js";
import type { ModerationAction } from "../modlog.js";
import { fetchMemberOrNull } from "../lookups.js";
import { performAction } from "../perform.js";
import { replyError } from "../reply.js";

export interface CommandAction {
  action: ModerationAction;
  target: User;
  durationMs?: number | null;
  unreadableDuration?: string;
}

/**
 * Hands a slash command to the shared performer and turns a refusal into the
 * ephemeral reply the command has always given. Returns the stored record,
 * or null once a refusal has been sent.
 */
export async function runFromCommand(
  interaction: ChatInputCommandInteraction,
  ctx: ModuleContext<ModerationSettings>,
  request: CommandAction,
): Promise<InfractionRecord | null> {
  try {
    // An unban weighs nobody's roles, so it has never needed the moderator's member.
    const actorMember =
      request.action === "unban" ? null : await fetchMemberOrNull(ctx.guild, interaction.user.id);
    const { record } = await performAction(ctx, {
      action: request.action,
      targetId: request.target.id,
      targetName: request.target.username,
      moderatorId: interaction.user.id,
      reason: interaction.options.getString("reason"),
      durationMs: request.durationMs ?? null,
      unreadableDuration: request.unreadableDuration,
      deleteDays: null,
      actorMember,
      actorIsInstanceOwner: false,
      origin: "command",
    });
    return record;
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    await replyError(interaction, error.message);
    return null;
  }
}
