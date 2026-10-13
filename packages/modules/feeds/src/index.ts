import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { defineModule, plainReply } from "@tier0/core";
import { prisma } from "@tier0/db";
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

const SEND_REPLY = plainReply("Sent {posted} of the latest {count} from {source}. {problem}");

const intervalOf = (ctx: FeedsContext): number => Math.max(ctx.settings.pollEvery, MIN_POLL_MS);

async function runStatus(interaction: ChatInputCommandInteraction, ctx: FeedsContext): Promise<void> {
  const sources = sourcesOf(ctx.settings);
  if (sources.length === 0) {
    await interaction.reply({
      content: "Nothing is being watched yet. Add a feed or a game in the dashboard.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cursors = await prisma.feedCursor.findMany({ where: { guildId: ctx.guild.id } });
  const byKey = new Map(cursors.map((cursor) => [cursor.sourceKey, cursor]));

  const lines = sources.map((source) => {
    const cursor = byKey.get(source.key);
    if (!cursor?.checkedAt) return `${source.label}: not checked yet`;
    const when = `<t:${Math.floor(cursor.checkedAt.getTime() / 1000)}:R>`;
    return cursor.lastError
      ? `${source.label}: checked ${when}, problem: ${cursor.lastError}`
      : `${source.label}: checked ${when}, working`;
  });

  await interaction.reply({ content: lines.join("\n").slice(0, 1900), flags: MessageFlags.Ephemeral });
}

async function runSend(interaction: ChatInputCommandInteraction, ctx: FeedsContext): Promise<void> {
  const query = interaction.options.getString("source", true);
  const count = clampCount(interaction.options.getInteger("count"));

  const matches = matchSources(sourcesOf(ctx.settings), query);
  if (matches.length === 0) {
    await interaction.reply({
      content: `Nothing being watched matches "${query}". /feeds status lists everything.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (matches.length > 1) {
    const names = matches.map((source) => source.label).join("\n");
    await interaction.reply({
      content: `"${query}" matches more than one source. Use a more specific name:\n${names}`.slice(0, 1900),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [source] = matches;
  if (!source) return;

  // Fetching and posting can outrun the three seconds Discord allows for a reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await sendLatest(ctx, source, count);

  const sent = `Sent ${result.posted} of the latest ${count} from ${source.label}.`;
  const custom = ctx.customReply?.({
    posted: result.posted,
    count,
    source: source.label,
    problem: result.error ? `Stopped because: ${result.error}.` : "",
  });
  // Visibility was fixed when the reply was deferred, so the flags an owner reply might carry do not apply.
  const { flags: _flags, ...editable } = custom ?? {};
  await interaction.editReply(custom ? editable : (result.error ? `${sent} Stopped because: ${result.error}.` : sent));
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
        note: "Used for the answer to /feeds send. /feeds status, and the answers that say nothing matched, keep their own wording.",
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
