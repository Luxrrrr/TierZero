import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import type { InteractionReplyOptions } from "discord.js";
import type { CommandDefinition, ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { historyFor } from "../infractions.js";
import { historyList } from "../history-list.js";
import { NOT_STAFF, staffRoleOf } from "../staff.js";
import { HISTORY_REPLY } from "../messages.js";

/**
 * What /history and the right-click menu both show, or null when the member has
 * no record. The owner's reply is used when there is one.
 */
export async function historyReply(
  ctx: ModuleContext<ModerationSettings>,
  userId: string,
  username: string,
): Promise<InteractionReplyOptions | null> {
  const records = await historyFor(ctx.guild.id, userId);
  if (records.length === 0) return null;

  const list = historyList(records);

  const custom = ctx.customReply?.({ user: username, count: records.length, list });
  if (custom) return custom;
  return { embeds: [new EmbedBuilder().setTitle(`Moderation history for ${username}`).setDescription(list)] };
}

export const historyCommand: CommandDefinition<ModerationSettings> = {
  name: "history",
  response: HISTORY_REPLY,
  description: "List a member's moderation history.",
  build: () =>
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("List a member's moderation history.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who").setRequired(true),
      ),
  async run(interaction, ctx) {
    if (!(await staffRoleOf(ctx.guild.id, interaction.user.id))) {
      await interaction.reply({ content: NOT_STAFF, flags: MessageFlags.Ephemeral });
      return;
    }
    const target = interaction.options.getUser("member", true);
    const reply = await historyReply(ctx, target.id, target.username);

    if (!reply) {
      await interaction.reply({
        content: `${target.username} has no recorded history.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
  },
};
