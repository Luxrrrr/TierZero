import type { GuildBasedChannel, GuildMember, Message, PartialGuildMember, ThreadChannel, User } from "discord.js";
import { Cooldowns, RateLimit, check, type Verdict } from "./logic.js";
import { placesOf, runSteps, safe, warn, type Env, type Runnable, type Scope } from "./run.js";

/**
 * What sets a workflow off, from whichever event it came from: the checks it has
 * to pass, how often it may run, and the values its messages are filled from.
 */

/** Per member and workflow, for the wait a workflow asks for. */
export const cooldowns = new Cooldowns();

/** Most runs one server gets in a minute, and most one workflow gets, so a flood of triggers cannot become a flood of actions. */
const serverLimit = new RateLimit(120, 60_000);
const workflowLimit = new RateLimit(30, 60_000);

export interface Cause {
  member: GuildMember | PartialGuildMember | null;
  user: Pick<User, "id" | "username"> & { displayName?: string };
  channel: GuildBasedChannel | ThreadChannel | null;
  message: Message | null;
  /** Who wrote the message, when that is not the member. */
  author?: { id: string; name: string } | null;
  /** Values only some triggers have, such as the emoji or the role. */
  extra?: Record<string, string>;
  /** What a command was given, by the option's name. */
  options?: Record<string, string>;
}

/** What a workflow is held to before it runs. */
export interface Gated {
  id: string;
  cooldown: number;
  onlyChannels: readonly string[];
  onlyRoles: readonly string[];
  exceptRoles: readonly string[];
  chance: number;
}

export function valuesOf(cause: Cause): Record<string, string> {
  const name = cause.member && "displayName" in cause.member && cause.member.displayName ? cause.member.displayName : (cause.user.displayName ?? cause.user.username);
  return {
    user: `<@${cause.user.id}>`,
    userName: safe(name, 100),
    username: safe(cause.user.username, 100),
    userId: cause.user.id,
    channel: cause.channel ? `<#${cause.channel.id}>` : "",
    channelName: cause.channel?.name ?? "",
    message: safe(cause.message?.content ?? ""),
    messageLink: cause.message?.url ?? "",
    author: cause.author ? `<@${cause.author.id}>` : "",
    authorName: cause.author ? safe(cause.author.name, 100) : "",
    emoji: "",
    role: "",
    roleMention: "",
    ...cause.extra,
    ...cause.options,
  };
}

export function scopeFor(workflow: { id: string }, cause: Cause): Scope {
  return {
    workflowId: workflow.id,
    vars: valuesOf(cause),
    memberId: cause.user.id,
    authorId: cause.author?.id ?? null,
    channelId: cause.channel?.id ?? null,
    messageId: cause.message?.id ?? null,
    replied: false,
    problems: [],
  };
}

const roll = () => Math.floor(Math.random() * 100);

export function subjectOf(cause: Cause) {
  const roleIds = cause.member && "roles" in cause.member && cause.member.roles ? [...cause.member.roles.cache.keys()] : [];
  return { channelIds: placesOf(cause.channel), roleIds };
}

/** The conditions of a workflow against who and where it happened. A command ignores the chance, since a command that sometimes does nothing is only confusing. */
export function allowed(workflow: Gated, cause: Cause, command = false): Verdict {
  return check({ ...workflow, chance: command ? 100 : workflow.chance }, subjectOf(cause), roll());
}

export type Gate = { ok: true } | { ok: false; reason: "rate" | "cooldown"; left?: number };

/** Counts a run against the limits, or says which one stopped it. Only counts when it goes ahead. */
export function admit(guildId: string, workflow: { id: string; cooldown: number }, memberId: string, now = Date.now()): Gate {
  const left = cooldowns.left(`${workflow.id}:${memberId}`, workflow.cooldown, now);
  if (left > 0) return { ok: false, reason: "cooldown", left };
  if (!serverLimit.allow(guildId, now) || !workflowLimit.allow(`${guildId}:${workflow.id}`, now)) return { ok: false, reason: "rate" };
  cooldowns.mark(`${workflow.id}:${memberId}`, now);
  return { ok: true };
}

/** Runs a workflow for a cause that is not a command: checks it may, then does the steps. */
export async function fire(env: Env, workflow: Runnable & Gated, cause: Cause): Promise<void> {
  if (!allowed(workflow, cause).ok) return;
  if (!admit(env.ctx.guild.id, workflow, cause.user.id).ok) return;
  await runSteps(env, workflow, scopeFor(workflow, cause)).catch(warn(`run workflow ${workflow.id}`));
}

/** The scope of a run that nobody set off, such as one on a schedule. Steps that need a member or a message have none to act on. */
export function scopeForNobody(workflow: { id: string }): Scope {
  const empty = ["user", "userName", "username", "userId", "channel", "channelName", "message", "messageLink", "author", "authorName", "emoji", "role", "roleMention"];
  return { workflowId: workflow.id, vars: Object.fromEntries(empty.map((name) => [name, ""])), memberId: null, authorId: null, channelId: null, messageId: null, replied: false, problems: [] };
}
