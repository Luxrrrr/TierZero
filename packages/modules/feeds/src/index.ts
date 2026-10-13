import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { applyVariables, defineModule, embedReply } from "@tier0/core";
import { prisma } from "@tier0/db";
import { AMBIGUOUS, NO_MATCH, STATUS_EMPTY, STATUS_REPLY } from "./labels.js";
import { MAX_SEND, clampCount, matchSources } from "./match.js";
import { MIN_POLL_MS, pollAll, sendLatest } from "./poll.js";
import { sourcesOf } from "./sources.js";
import { feedRows } from "./rows.js";
import { settingsSchema, type FeedsContext } from "./settings.js";

/** Long enough for the settings write to land before the first check reads it. */
const FIRST_CHECK_MS = 5_000;

/**
 * Polling is a task that schedules its own successor, so it rides on the same
 * persisted queue as every other deferred job and survives a restart. The
 * `finally` matters: a poll that throws must still book the next one, or the
 * module would go quiet until somebody toggled it.
 */
async function scheduleNext(ctx: FeedsContext, delayMs: number): Promise<void> {
  await ctx.tasks.cancel("poll");
  await ctx.tasks.schedule("poll", new Date(Date.now() + delayMs));
}

const SEND_REPLY = embedReply("Sent {posted} of the latest {count} from {source}. {problem}", "success");

const intervalOf = (ctx: FeedsContext): number => Math.max(ctx.settings.pollEvery, MIN_POLL_MS);

/** Discord stops a message at 2000 characters; lists are cut here so the text around them still fits. */
const LIST_LIMIT = 1900;

async function runStatus(interaction: ChatInputCommandInteraction, ctx: FeedsContext): Promise<void> {
  const sources = sourcesOf(ctx.settings);
  if (sources.length === 0) {
    await ctx.reply(interaction, ctx.settings.replies.statusEmpty, {}, { fallback: STATUS_EMPTY });
    return;
  }

  const cursors = await prisma.feedCursor.findMany({ where: { guildId: ctx.guild.id } });
  const byKey = new Map(cursors.map((cursor) => [cursor.sourceKey, cursor]));

  const { labels } = ctx.settings;
  const lines = sources.map((source) => {
    const cursor = byKey.get(source.key);
    if (!cursor?.checkedAt) return applyVariables(labels.statusNever, { source: source.label });
    const checked = `<t:${Math.floor(cursor.checkedAt.getTime() / 1000)}:R>`;
    return cursor.lastError
      ? applyVariables(labels.statusProblem, { source: source.label, checked, problem: cursor.lastError })
      : applyVariables(labels.statusWorking, { source: source.label, checked });
  });

  await ctx.reply(
    interaction,
    ctx.settings.replies.status,
    { lines: lines.join("\n").slice(0, LIST_LIMIT), count: sources.length },
    { fallback: STATUS_REPLY },
  );
}

async function runSend(interaction: ChatInputCommandInteraction, ctx: FeedsContext): Promise<void> {
  const query = interaction.options.getString("source", true);
  const count = clampCount(interaction.options.getInteger("count"));

  const matches = matchSources(sourcesOf(ctx.settings), query);
  if (matches.length === 0) {
    await ctx.reply(interaction, ctx.settings.replies.noMatch, { query }, { fallback: NO_MATCH });
    return;
  }
  if (matches.length > 1) {
    // The list gets whatever room the sentence around it leaves, as a message cut after the fact would lose its end.
    const room = LIST_LIMIT - applyVariables(AMBIGUOUS.embeds[0]?.description ?? "", { query, sources: "" }).length;
    const names = matches.map((source) => source.label).join("\n").slice(0, Math.max(0, room));
    await ctx.reply(interaction, ctx.settings.replies.ambiguous, { query, sources: names }, { fallback: AMBIGUOUS });
    return;
  }

  const [source] = matches;
  if (!source) return;

  // Fetching and posting can outrun the three seconds Discord allows for a reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await sendLatest(ctx, source, count);

  const values = {
    posted: result.posted,
    count,
    source: source.label,
    problem: result.error ? applyVariables(ctx.settings.labels.stopped, { error: result.error }) : "",
  };
  const custom = ctx.customReply?.(values);
  if (!custom) {
    await ctx.reply(interaction, SEND_REPLY, values);
    return;
  }
  // Visibility was fixed when the reply was deferred, so the flags an owner reply might carry do not apply.
  const { flags: _flags, ...editable } = custom;
  await interaction.editReply(editable);
}

export default defineModule({
  id: "feeds",
  name: "News and patch notes",
  summary: "Posts new items from RSS feeds and Steam patch notes, so announcements never depend on a channel being followable.",
  category: "engagement",

  settings: settingsSchema,

  commands: [
    {
      name: "feeds",
      description: "See what the bot is watching, or send a source's latest posts now.",
      response: {
        starting: SEND_REPLY,
        placeholders: [
          { name: "posted", description: "How many posts were sent", sample: "3" },
          { name: "count", description: "How many were asked for", sample: "3" },
          { name: "source", description: "The feed or game they came from", sample: "Example Gazette" },
          { name: "problem", description: "Why it stopped early, as a sentence. Empty when everything was sent", sample: "" },
        ],
        note: "Used for the answer to /feeds send. /feeds status, and the answers that say nothing matched, are reworded under Replies and errors on the module's page.",
      },
      build: () =>
        new SlashCommandBuilder()
          .setName("feeds")
          .setDescription("See what the bot is watching, or send a source's latest posts now.")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) =>
            sub.setName("status").setDescription("Show what is being watched and when it was last checked."),
          )
          .addSubcommand((sub) =>
            sub
              .setName("send")
              .setDescription("Post the latest items from a feed or game to its channel now.")
              .addStringOption((option) =>
                option
                  .setName("source")
                  .setDescription("Part of the feed's name or address, or the game's name")
                  .setRequired(true),
              )
              .addIntegerOption((option) =>
                option
                  .setName("count")
                  .setDescription(`How many of the latest posts to send, up to ${MAX_SEND}`)
                  .setMinValue(1)
                  .setMaxValue(MAX_SEND),
              ),
          ),
      async run(interaction, ctx) {
        if (interaction.options.getSubcommand() === "send") {
          await runSend(interaction, ctx);
        } else {
          await runStatus(interaction, ctx);
        }
      },
    },
  ],

  rows: feedRows,

  tasks: {
    async poll(_payload, ctx) {
      try {
        await pollAll(ctx);
      } finally {
        await scheduleNext(ctx, intervalOf(ctx));
      }
    },
  },

  onEnable: (ctx) => scheduleNext(ctx, FIRST_CHECK_MS),
  onSettingsChange: (ctx) => scheduleNext(ctx, FIRST_CHECK_MS),
  async onDisable(ctx) {
    await ctx.tasks.cancel("poll");
  },

  requires: ["SendMessages", "EmbedLinks"],
});
