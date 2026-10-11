import { cache } from "react";
import { getGuildModules, listBotGuilds } from "./control-api";

/**
 * Request-scoped wrappers around the two control API reads a signed-in page
 * makes. The guild layout renders the sidebar from the same module list the
 * page below it renders its content from, and React's cache collapses those
 * into one call per request instead of two.
 *
 * Server components only: control-api.ts holds INTERNAL_API_SECRET.
 */

export const botGuilds = cache(listBotGuilds);

export const guildModules = cache(getGuildModules);
