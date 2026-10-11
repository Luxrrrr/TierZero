import type { RowRef } from "@tier0/core";
import type { FeedsContext } from "./settings.js";

export type Scope = "patch" | "all";

export type FeedRow = FeedsContext["settings"]["news"]["feeds"][number];

export type Source =
  | { kind: "rss"; key: string; label: string; search: string; row: FeedRow }
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
    };

/**
 * The sources the settings ask for, one per key. A repeated address is read
 * once. A game listed under two channels is two sources, since each channel
 * has its own idea of what it has already been shown.
 */
export function sourcesOf(settings: FeedsContext["settings"]): Source[] {
  const sources = new Map<string, Source>();

  if (settings.news.enabled) {
    for (const row of settings.news.feeds) {
      const key = `rss:${row.url}`;
      if (!sources.has(key)) {
        sources.set(key, { kind: "rss", key, label: row.name ?? row.url, search: `${row.name ?? ""} ${row.url}`, row });
      }
    }
  }
  if (settings.patchNotes.enabled) {
    for (const destination of settings.patchNotes.destinations) {
      for (const game of destination.games) {
        const key = `steam:${game.appId}:${destination.channel}`;
        if (sources.has(key)) continue;
        sources.set(key, {
          kind: "steam",
          key,
          label: `${game.name} in <#${destination.channel}>`,
          search: `${game.name} ${game.appId}`,
          appId: game.appId,
          game: game.name,
          scope: game.scope === "all" ? "all" : "patch",
          channel: destination.channel,
          mention: destination.mention,
        });
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
    const name = typeof row["name"] === "string" && row["name"] !== "" ? row["name"] : undefined;
    return {
      kind: "rss",
      key: `rss:${url}`,
      label: name ?? url,
      search: `${name ?? ""} ${url}`,
      row: row as FeedRow,
    };
  }

  const appId = row["appId"];
  const game = row["name"];
  const channel = parent["channel"];
  if (typeof appId !== "number" || typeof game !== "string" || typeof channel !== "string") return null;
  return {
    kind: "steam",
    key: `steam:${appId}:${channel}`,
    label: `${game} in <#${channel}>`,
    search: `${game} ${appId}`,
    appId,
    game,
    scope: row["scope"] === "all" ? "all" : "patch",
    channel,
    mention: typeof parent["mention"] === "string" ? parent["mention"] : undefined,
  };
}
