import { InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { GamingCtx } from "./context.js";
import { gameKey } from "./lfg.js";
import { NOTE_MAX, requestPlayers } from "./lfg-request.js";
import type { GamingSettings } from "./settings.js";

/**
 * `/lfg`: a member asks for players. The game list, the channels, the limits
 * and the wording all come from the settings, so nothing here is a decision
 * the server owner cannot change.
 */

const SUGGESTIONS = 25;

function build(): ReturnType<CommandDefinition["build"]> {
  return new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Ask for players for a game.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) => option.setName("game").setDescription("The game.").setRequired(true).setAutocomplete(true).setMaxLength(60))
    .addIntegerOption((option) =>
      option.setName("players").setDescription("How many more players you need.").setRequired(true).setMinValue(1).setMaxValue(15),
    )
    .addStringOption((option) => option.setName("note").setDescription("Anything players should know, such as a rank.").setMaxLength(NOTE_MAX))
    .addStringOption((option) => option.setName("when").setDescription("When you start, such as 20:00 or in 90m. Left out, now.").setMaxLength(60));
}

async function run(interaction: ChatInputCommandInteraction, ctx: GamingCtx): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await requestPlayers(ctx, interaction, {
    game: interaction.options.getString("game", true),
    needed: interaction.options.getInteger("players", true),
    note: interaction.options.getString("note"),
    when: interaction.options.getString("when"),
  });
}

async function autocomplete(interaction: Parameters<NonNullable<CommandDefinition<GamingSettings>["autocomplete"]>>[0], ctx: GamingCtx): Promise<void> {
  const typed = interaction.options.getFocused().trim().toLowerCase();
  const matches = ctx.settings.lfg.games
    .filter((game) => typed === "" || game.name.toLowerCase().includes(typed))
    .slice(0, SUGGESTIONS)
    .map((game) => ({ name: game.name.slice(0, 100), value: gameKey(game).slice(0, 100) }));
  await interaction.respond(matches);
}

export const lfgCommand: CommandDefinition<GamingSettings> = {
  name: "lfg",
  description: "Ask for players for a game.",
  publicReply: false,
  build,
  run,
  autocomplete,
};
