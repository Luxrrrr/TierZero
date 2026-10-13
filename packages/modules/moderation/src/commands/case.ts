import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { findByCaseNumber } from "../infractions.js";
import { clip, moderatorName, noticeValues } from "../modlog.js";
import { CASE_REPLY } from "../messages.js";
import { say } from "../reply.js";
import { staffRoleOf } from "../staff.js";
import { answer } from "./answer.js";

/** Discord's limit on an embed field's value, which the Reason field is. */
const FIELD_MAX = 1024;

export const caseCommand: CommandDefinition<ModerationSettings> = {
  name: "case",
  response: CASE_REPLY,
  description: "Show one moderation case.",
  build: () =>
    new SlashCommandBuilder()
      .setName("case")
      .setDescription("Show one moderation case.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addIntegerOption((option) =>
        option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1),
      ),
  async run(interaction, ctx) {
    if (!(await staffRoleOf(ctx.guild.id, interaction.user.id))) {
      await say(ctx, interaction, "staff", "notStaff");
      return;
    }
    const number = interaction.options.getInteger("number", true);
    const record = await findByCaseNumber(ctx.guild.id, number);
    if (!record) {
      await say(ctx, interaction, "lookups", "caseNotFound", { number });
      return;
    }

    const labels = ctx.settings.labels;
    const entry = {
      caseNumber: record.caseNumber,
      action: record.action,
      targetId: record.userId,
      moderatorId: record.moderatorId,
      moderatorName: moderatorName(record.action, record.moderatorId, ctx.client.user?.id ?? null, labels),
      reason: record.reason,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      links: { guildId: ctx.guild.id, dashboardBase: await ctx.dashboardUrl() },
    };

    const values = noticeValues(entry, labels);
    // The Reason field of the stock look is an embed field, which Discord keeps to 1024 characters.
    if (typeof values.reason === "string") values.reason = clip(values.reason, FIELD_MAX);
    await answer(interaction, ctx, CASE_REPLY, { ...values, reversedNote: record.active ? "" : labels.history.caseReversed });
  },
};
