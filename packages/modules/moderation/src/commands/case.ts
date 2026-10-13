import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { dashboardLinks, type CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { findByCaseNumber } from "../infractions.js";
import { formatModLogEntry, moderatorName, noticeValues } from "../modlog.js";
import { CASE_REPLY } from "../messages.js";
import { replyError } from "../reply.js";
import { NOT_STAFF, staffRoleOf } from "../staff.js";

const REVERSED_NOTE = "This action has since been reversed.";

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
      await replyError(interaction, NOT_STAFF);
      return;
    }
    const number = interaction.options.getInteger("number", true);
    const record = await findByCaseNumber(ctx.guild.id, number);
    if (!record) {
      await replyError(interaction, `There is no case #${number}.`);
      return;
    }

    const dashboardBase = await ctx.dashboardUrl();
    const entry = {
      caseNumber: record.caseNumber,
      action: record.action,
      targetId: record.userId,
      moderatorId: record.moderatorId,
      moderatorName: moderatorName(record.action, record.moderatorId, ctx.client.user?.id ?? null),
      reason: record.reason,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      links: { guildId: ctx.guild.id, dashboardBase },
    };

    const custom = ctx.customReply?.({
      ...noticeValues(entry),
      reversedNote: record.active ? "" : REVERSED_NOTE,
    });
    if (custom) {
      await interaction.reply({ ...custom, flags: MessageFlags.Ephemeral });
      return;
    }

    const view = formatModLogEntry(entry);

    const embed = new EmbedBuilder().setTitle(view.title).addFields(view.fields).setTimestamp(record.createdAt);
    if (!record.active) {
      embed.setFooter({ text: REVERSED_NOTE });
    }

    // The same button the stock mod log post has, left out while the dashboard's address is not known.
    const { caseUrl } = dashboardLinks(dashboardBase, ctx.guild.id, record.userId, record.caseNumber);
    const components =
      caseUrl === ""
        ? []
        : [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("View in dashboard").setStyle(ButtonStyle.Link).setURL(caseUrl))];

    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  },
};
