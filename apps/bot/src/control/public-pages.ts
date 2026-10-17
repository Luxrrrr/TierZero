import type { Guild } from "discord.js";
import type { ModuleNotice, ModuleRegistry } from "@tier0/core";
import { clampPage, publicLeaderboard } from "@tier0/module-leveling";
import type { GuildState } from "../runtime/guild-state.js";

export interface Reply {
  status: number;
  body: unknown;
}

const NOT_PUBLIC: Reply = { status: 404, body: { error: "This leaderboard is not public." } };

/**
 * One page of a server's leaderboard for the public page. Read only. A server
 * whose owner has not switched the page on answers exactly as a server the bot
 * is not in, so the route cannot be used to find out which servers use the bot.
 */
export async function leaderboardPage(state: GuildState, guild: Guild | undefined, rawPage: string | null): Promise<Reply> {
  if (!guild || !(await state.isEnabled(guild.id, "leveling"))) return NOT_PUBLIC;
  const ctx = await state.context(guild, "leveling");
  const page = (ctx?.settings as { publicPage?: { enabled?: boolean; indexed?: boolean } } | undefined)?.publicPage;
  if (!ctx || page?.enabled !== true) return NOT_PUBLIC;
  return { status: 200, body: await publicLeaderboard(guild, clampPage(rawPage), page.indexed === true) };
}

/** The lines a module shows above its settings form. Empty for a module without any. */
export async function moduleNotices(registry: ModuleRegistry, state: GuildState, guild: Guild, moduleId: string): Promise<Reply> {
  const hook = registry.get(moduleId)?.notices;
  if (!hook) return { status: 200, body: { notices: [] } };
  const ctx = await state.context(guild, moduleId);
  if (!ctx) return { status: 200, body: { notices: [] } };
  let notices: ModuleNotice[];
  try {
    notices = await hook(ctx as never);
  } catch (error) {
    console.error(`[${moduleId}] notices failed:`, error);
    notices = [];
  }
  return { status: 200, body: { notices } };
}
