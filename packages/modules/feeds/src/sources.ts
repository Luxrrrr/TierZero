import type { MessageBody, RowRef } from "@tier0/core";
import type { FeedsContext } from "./settings.js";

export type Scope = "patch" | "all";

export type FeedRow = FeedsContext["settings"]["news"]["feeds"][number];

export type Source =
  | {
      kind: "rss";
      key: string;
      /** Where this feed's progress was kept before feeds were tracked per channel. */
      legacyKey: string;
      label: string;
      search: string;
      row: FeedRow;
      /** The feed's own post, when it has one. */
      message: MessageBody | undefined;
    }
  | {
      kind: "steam";
      key: string;
      label: string;
      search: string;
      appId: number;
      game: string;
      scope: Scope;
      channel: string;
      mention: string | undefined;
      message: MessageBody | undefined;
    };

/**
 * A feed is tracked per channel, so the same address listed for two channels
 * posts to both, each remembering what it has shown.
 */
export const rssKey = (url: string, channel: string): string => `rss:${url}:${channel}`;

const ownMessage = (holder: Record<string, unknown>): MessageBody | undefined =>
  holder["custom"] === true ? (holder["message"] as MessageBody | undefined) : undefined;

function rssSource(row: FeedRow & { url: string }): Source {
  const name = typeof row.name === "string" && row.name !== "" ? row.name : undefined;
  return {
    kind: "rss",
    key: rssKey(row.url, row.channel),
    legacyKey: `rss:${row.url}`,
    label: name ?? row.url,
    search: `${name ?? ""} ${row.url}`,
    row,
    message: ownMessage(row as unknown as Record<string, unknown>),
  };
}

function steamSource(game: Record<string, unknown>, destination: Record<string, unknown>): Source | null {
  const appId = Number(game["appId"]);
  const name = game["name"];
  const channel = destination["channel"];
  if (!Number.isInteger(appId) || appId <= 0 || typeof name !== "string" || typeof channel !== "string") return null;
  return {
    kind: "steam",
    key: `steam:${appId}:${channel}`,
    label: `${name} in <#${channel}>`,
    search: `${name} ${appId}`,
    appId,
    game: name,
    scope: game["scope"] === "all" ? "all" : "patch",
    channel,
    mention: typeof destination["mention"] === "string" ? destination["mention"] : undefined,
    message: ownMessage(destination),
  };
}

/**
 * The sources the settings ask for, one per key. The same address listed twice
 * for one channel is read once. A game listed under two channels is two
 * sources, since each channel has its own idea of what it has already been shown.
 */
export function sourcesOf(settings: FeedsContext["settings"]): Source[] {
  const sources = new Map<string, Source>();

  if (settings.news.enabled) {
    for (const row of settings.news.feeds) {
      // A row whose address was cleared as unreadable waits for a new one.
      if (!row.url) continue;
      const source = rssSource({ ...row, url: row.url });
      if (!sources.has(source.key)) sources.set(source.key, source);
    }
  }
  if (settings.patchNotes.enabled) {
    for (const destination of settings.patchNotes.destinations) {
      for (const game of destination.games) {
        const source = steamSource(game as unknown as Record<string, unknown>, destination as unknown as Record<string, unknown>);
        if (source && !sources.has(source.key)) sources.set(source.key, source);
      }
    }
  }
  return [...sources.values()];
}

/**
 * The source a dashboard row stands for, built the same way `sourcesOf` builds
 * it, so a status or an action lands on the same cursor the scheduled checks
 * use. Null when the row is not filled in far enough to be read.
 */
export function sourceForRow(listPath: string, ref: RowRef): Source | null {
  const { row, parent } = ref;
  if (listPath === "news.feeds") {
    const url = row["url"];
    const channel = row["channel"];
    if (typeof url !== "string" || url === "" || typeof channel !== "string") return null;
    return rssSource(row as unknown as FeedRow & { url: string });
  }
  return steamSource(row, parent);
}
