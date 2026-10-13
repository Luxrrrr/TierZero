import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { CommandDefinition, ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { historyFor } from "../infractions.js";
import { historyList, HISTORY_LIST_MAX } from "../history-list.js";
import { say, type Answerable } from "../reply.js";
import { staffRoleOf } from "../staff.js";
import { HISTORY_REPLY } from "../messages.js";
import { answer } from "./answer.js";

/**
 * Answers /history and the right-click menu with the member's record, in the
 * owner's reply when there is one, or says there is none.
 */
export async function replyWithHistory(
  ctx: ModuleContext<ModerationSettings>,
  interaction: Answerable,
  userId: string,
  username: string,
): Promise<void> {
  const records = await historyFor(ctx.guild.id, userId);
  if (records.length === 0) {
    await say(ctx, interaction, "lookups", "noHistory", { user: username });
    return;
  }

  const list = historyList(records, HISTORY_LIST_MAX, ctx.settings.labels);
  const values = { user: username, count: records.length, list };
  await answer(interaction, ctx, HISTORY_REPLY, values);
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
      await say(ctx, interaction, "staff", "notStaff");
      return;
    }
    const target = interaction.options.getUser("member", true);
    await replyWithHistory(ctx, interaction, target.id, target.username);
  },
};
