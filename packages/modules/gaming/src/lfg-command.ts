import { InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition, ReplyValues } from "@tier0/core";
import { answer, memberOf, warn, type GamingCtx } from "./context.js";
import { attachMessage, createPost, discardPost, lastPostedAt, openPostsOf } from "./lfg-store.js";
import { findGame, gameKey, scheduleExpiry, sendPost } from "./lfg.js";
import { LFG_REFUSALS, LFG_REPLIES, type LfgRefusalKey } from "./messages.js";
import { cooldownLeft, expiryOf } from "./party.js";
import type { GamingSettings } from "./settings.js";
import { WHEN_EXAMPLES, parseWhen, spokenWait } from "./time.js";

/**
 * `/lfg`: a member asks for players. The game list, the channels, the limits
 * and the wording all come from the settings, so nothing here is a decision
 * the server owner cannot change.
 */

const SUGGESTIONS = 25;
const NOTE_MAX = 300;

function build(): ReturnType<CommandDefinition["build"]> {
  return new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Ask for players for a game.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) => option.setName("game").setDescription("The game.").setRequired(true).setAutocomplete(true))
    .addIntegerOption((option) =>
      option.setName("players").setDescription("How many more players you need.").setRequired(true).setMinValue(1).setMaxValue(15),
    )
    .addStringOption((option) => option.setName("note").setDescription("Anything players should know, such as a rank.").setMaxLength(NOTE_MAX))
    .addStringOption((option) => option.setName("when").setDescription("When you start, such as 20:00 or in 90m. Left out, now.").setMaxLength(60));
}

const refuse = (ctx: GamingCtx, interaction: ChatInputCommandInteraction, key: LfgRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.lfgRefusals[key], LFG_REFUSALS[key], values);

async function run(interaction: ChatInputCommandInteraction, ctx: GamingCtx): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { lfg } = ctx.settings;
  if (lfg.games.length === 0) return refuse(ctx, interaction, "noGames");

  const game = findGame(ctx.settings, interaction.options.getString("game", true));
  if (!game) return refuse(ctx, interaction, "unknownGame");

  const needed = interaction.options.getInteger("players", true);
  if (needed > lfg.maxNeeded) return refuse(ctx, interaction, "badSize", { limit: lfg.maxNeeded });

  const now = new Date();
  const when = interaction.options.getString("when");
  let startsAt: Date | null = null;
  if (when) {
    const parsed = parseWhen(when, now, ctx.settings.timeZone);
    if (!parsed.ok) return refuse(ctx, interaction, "badTime", { examples: WHEN_EXAMPLES });
    startsAt = parsed.at;
  }

  if ((await openPostsOf(ctx.guild.id, interaction.user.id)) >= lfg.maxOpen) return refuse(ctx, interaction, "tooManyOpen", { limit: lfg.maxOpen });
  const wait = cooldownLeft(await lastPostedAt(ctx.guild.id, interaction.user.id), lfg.cooldown, now);
  if (wait > 0) return refuse(ctx, interaction, "cooldown", { remaining: spokenWait(wait) });

  const target = game.channel ?? lfg.channel;
  const channel = target ? (ctx.guild.channels.cache.get(target) ?? (await ctx.guild.channels.fetch(target).catch(() => null))) : interaction.channel;
  if (!channel?.isTextBased()) return refuse(ctx, interaction, "cannotPost");

  const member = await memberOf(ctx, interaction);
  const post = await createPost({
    guildId: ctx.guild.id,
    channelId: channel.id,
    gameId: gameKey(game),
    gameName: game.name,
    authorId: interaction.user.id,
    authorName: member?.displayName ?? interaction.user.username,
    needed,
    note: interaction.options.getString("note") ?? "",
    startsAt,
    expiresAt: expiryOf(now, startsAt, lfg.expiresAfter),
  });

  const message = await sendPost(ctx, channel, post);
  if (!message) {
    await discardPost(post.id);
    return refuse(ctx, interaction, "cannotPost");
  }
  await attachMessage(post.id, message.id);
  await scheduleExpiry(ctx, post).catch(warn(`schedule the expiry of post ${post.id}`));
  await answer(ctx, interaction, ctx.settings.messages.lfgReplies.posted, LFG_REPLIES.posted, { link: message.url, game: game.name });
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
