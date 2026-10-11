import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition, ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { parseDuration } from "../duration.js";
import { runFromCommand } from "./run-action.js";

type Ctx = ModuleContext<ModerationSettings>;

async function runSet(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const target = interaction.options.getUser("member", true);
  const durationInput = interaction.options.getString("duration");
  const durationMs =
    durationInput === null ? ctx.settings.defaultTimeoutDuration : parseDuration(durationInput);

  const record = await runFromCommand(interaction, ctx, {
    action: "timeout",
    target,
    durationMs,
    unreadableDuration: durationMs === null ? "Duration must look like 10m, 2h or 7d." : undefined,
  });
  if (!record) return;

  await interaction.reply({
    content: `Timed out ${target.username} until <t:${Math.floor(record.expiresAt!.getTime() / 1000)}:f>. Case #${record.caseNumber}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function runClear(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const target = interaction.options.getUser("member", true);
  const record = await runFromCommand(interaction, ctx, { action: "timeout-clear", target });
  if (!record) return;

  await interaction.reply({
    content: `Cleared ${target.username}'s timeout. Case #${record.caseNumber}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export const timeoutCommand: CommandDefinition<ModerationSettings> = {
  name: "timeout",
  description: "Time a member out, or lift an existing timeout.",
  build: () =>
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time a member out, or lift an existing timeout.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Time a member out.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to time out").setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("How long, e.g. 10m, 2h, 7d. Defaults to the server's setting."),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("clear")
          .setDescription("Lift a member's timeout.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to clear").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      ),
  async run(interaction, ctx) {
    const sub = interaction.options.getSubcommand(true);
    if (sub === "set") {
      await runSet(interaction, ctx);
    } else {
      await runClear(interaction, ctx);
    }
  },
};
