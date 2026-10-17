import type { RowAction, RowHooks, RowRef, RowStatus } from "@tier0/core";
import { s } from "@tier0/core";
import { prisma } from "@tier0/db";
import { ago } from "./ago.js";
import { sentence } from "./failures.js";
import { MAX_SEND } from "./match.js";
import { sendLatest } from "./poll.js";
import { sourceForRow, type Source } from "./sources.js";
import type { FeedsContext, FeedsSettings } from "./settings.js";

const FEEDS = "news.feeds";
const NO_ADDRESS: RowStatus = { tone: "problem", text: "No feed address. Add one and save." };
const GAMES = "patchNotes.destinations.games";

type Cursor = { checkedAt: Date | null; lastError: string | null };

function statusOf(cursor: Cursor | undefined): RowStatus {
  if (!cursor?.checkedAt) return { tone: "idle", text: "Not checked yet" };
  if (cursor.lastError) return { tone: "problem", text: sentence(cursor.lastError) };
  return { tone: "ok", text: `Working, checked ${ago(cursor.checkedAt)}` };
}

async function statuses(ctx: FeedsContext, rows: RowRef[], kind: Source["kind"]): Promise<(RowStatus | null)[]> {
  const sources = rows.map((row) => sourceForRow(kind === "rss" ? FEEDS : GAMES, row));
  const keys = sources.flatMap((source) => (source ? [source.key, ...(source.kind === "rss" ? [source.legacyKey] : [])] : []));
  const cursors =
    keys.length === 0 ? [] : await prisma.feedCursor.findMany({ where: { guildId: ctx.guild.id, sourceKey: { in: keys } } });
  const byKey = new Map(cursors.map((cursor) => [cursor.sourceKey, cursor]));
  // A feed not checked since feeds were tracked per channel shows what was last known of its address.
  return sources.map((source, index) => {
    if (source) return statusOf(byKey.get(source.key) ?? (source.kind === "rss" ? byKey.get(source.legacyKey) : undefined));
    return kind === "rss" && !rows[index]?.row["url"] ? NO_ADDRESS : null;
  });
}

const send: RowAction<FeedsSettings> = {
  label: "Send latest posts",
  help: "Posts the most recent items to this source's channel now, whether or not they were posted before.",
  input: s.object({
    count: s.integer({ label: "How many posts", min: 1, max: MAX_SEND, default: 3 }),
  }),
  async run({ ctx, row, input }) {
    const source = sourceForRow(row.path.includes("games") ? GAMES : FEEDS, row);
    if (!source) return { ok: false, message: "That entry is incomplete. Fill it in and save first." };

    const count = Number(input["count"] ?? 3);
    const result = await sendLatest(ctx, source, count);

    const channel = source.kind === "rss" ? source.row.channel : source.channel;
    const name = ctx.guild.channels.cache.get(channel)?.name;
    const where = name ? `#${name}` : "its channel";
    if (result.error) {
      return {
        ok: false,
        message: result.posted > 0
          ? `Sent ${result.posted} to ${where}, then stopped: ${result.error}.`
          : `Nothing was sent: ${result.error}.`,
      };
    }
    if (result.posted === 0) return { ok: true, message: "There was nothing to send." };
    return { ok: true, message: `Sent ${result.posted} ${result.posted === 1 ? "post" : "posts"} to ${where}.` };
  },
};

export const feedRows: Record<string, RowHooks<FeedsSettings>> = {
  [FEEDS]: {
    status: ({ ctx, rows }) => statuses(ctx, rows, "rss"),
    actions: { send },
  },
  [GAMES]: {
    status: ({ ctx, rows }) => statuses(ctx, rows, "steam"),
    actions: { send },
  },
};
