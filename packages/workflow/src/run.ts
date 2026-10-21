import { PermissionFlagsBits, type ChatInputCommandInteraction, type GuildBasedChannel, type GuildMember, type Message, type ThreadChannel } from "discord.js";
import { applyVariables, isRoleAssignable, type MessageBody, type ModuleContext } from "@tier0/core";
import { layoutOf, isIf } from "./layout.js";
import { check, compare, defuse, matchesMessage, rolesIn } from "./logic.js";
import { STEP_MESSAGE } from "./messages.js";
import type { Step, Target } from "./steps.js";
import { change as changeValue, read as readValues, type Scope as CounterScope } from "./values.js";

/**
 * Carries out a list of steps. Each step reports what went wrong as a short
 * sentence instead of throwing, so one step that cannot run, such as a role the
 * bot cannot give, does not stop the ones after it.
 */

export type Ctx = ModuleContext<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Anything with steps to run: an automation, a custom command. */
export interface Runnable {
  id: string;
  name: string;
  /** For a command that is answered: whether the reply is private. */
  reply?: "private" | "public";
  steps: readonly Step[];
}

/** What a run knows about what set it off. Everything but the interaction is kept as text, so a run that waits can be stored and picked up again. */
export interface Scope {
  workflowId: string;
  vars: Record<string, string>;
  memberId: string | null;
  /** Who wrote the message, which is not the member when a reaction set it off. */
  authorId: string | null;
  channelId: string | null;
  messageId: string | null;
  /** Only while a command is being answered. A run that waited has none. */
  interaction?: ChatInputCommandInteraction;
  /** Whether a step has answered the command. */
  replied: boolean;
  problems: string[];
}

export interface Env {
  ctx: Ctx;
  /** Finds another workflow by the name a step gives. */
  find(name: string): Runnable | undefined;
  /** How many workflows deep this is, so one that runs itself stops. */
  depth?: number;
}

export const warn = (what: string) => (error: unknown) => console.warn(`[workflow] could not ${what}:`, error);

/** Longest value kept for a run that waits, so a stored run stays small. */
const KEPT = 500;
const MAX_DEPTH = 3;
const MAX_TIMEOUT_MS = 28 * 86_400_000;

/** Where a run that waits is stored, as plain data. */
export function freeze(scope: Scope, from: number): Record<string, unknown> {
  return {
    workflowId: scope.workflowId,
    from,
    memberId: scope.memberId,
    authorId: scope.authorId,
    channelId: scope.channelId,
    messageId: scope.messageId,
    vars: Object.fromEntries(Object.entries(scope.vars).map(([key, value]) => [key, value.slice(0, KEPT)])),
  };
}

export function thaw(payload: Record<string, unknown>): { scope: Scope; from: number } | null {
  if (typeof payload.workflowId !== "string" || typeof payload.from !== "number") return null;
  const vars = payload.vars && typeof payload.vars === "object" ? Object.fromEntries(Object.entries(payload.vars).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    scope: {
      workflowId: payload.workflowId,
      vars,
      memberId: text(payload.memberId),
      authorId: text(payload.authorId),
      channelId: text(payload.channelId),
      messageId: text(payload.messageId),
      replied: false,
      problems: [],
    },
    from: payload.from,
  };
}

// -- who and what a step acts on ------------------------------------------------------------------------------

async function memberById(ctx: Ctx, id: string | null): Promise<GuildMember | null> {
  if (!id) return null;
  return ctx.guild.members.cache.get(id) ?? (await ctx.guild.members.fetch(id).catch(() => null));
}

const aimedAt = (scope: Scope, who: Target | undefined): string | null => (who === "author" ? (scope.authorId ?? scope.memberId) : scope.memberId);

async function messageOf(ctx: Ctx, scope: Scope): Promise<Message | null> {
  if (!scope.channelId || !scope.messageId) return null;
  const channel = ctx.guild.channels.cache.get(scope.channelId);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(scope.messageId).catch(() => null);
}

/** The channel, then what sits above it, so a rule on a category reaches a thread in it. */
export function placesOf(channel: GuildBasedChannel | ThreadChannel | null | undefined): string[] {
  const ids: string[] = [];
  let at: GuildBasedChannel | ThreadChannel | null | undefined = channel;
  for (let step = 0; step < 3 && at; step += 1) {
    ids.push(at.id);
    at = at.parent ?? null;
  }
  return ids;
}

// -- counters in a message ----------------------------------------------------------------------------------

/** The counters a list of steps uses, by name, and which kind each is. A name used both ways counts as the member's. */
export function countersOf(steps: readonly Step[]): Map<string, CounterScope> {
  const found = new Map<string, CounterScope>();
  for (const step of steps) {
    const pairs: [string | undefined, CounterScope | undefined][] = [
      [step.type === "variable" ? step.setName : undefined, step.setScope],
      [step.type === "ifVariable" ? step.testName : undefined, step.testScope],
    ];
    for (const [name, scope] of pairs) {
      if (!name) continue;
      if (found.get(name) !== "member") found.set(name, scope ?? "member");
    }
  }
  return found;
}

/** Fills the values a text asks for from the counters it names. */
async function withCounters(env: Env, runnable: Runnable, scope: Scope, ...texts: (string | MessageBody)[]): Promise<Record<string, string>> {
  const declared = countersOf(runnable.steps);
  if (declared.size === 0) return scope.vars;
  const used = new Set([...JSON.stringify(texts).matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).filter((name) => declared.has(name)));
  if (used.size === 0) return scope.vars;
  const filled = { ...scope.vars };
  for (const kind of ["member", "server"] as const) {
    const names = [...used].filter((name) => declared.get(name) === kind);
    if (names.length === 0) continue;
    const values = await readValues(env.ctx.guild.id, kind, scope.memberId, names);
    for (const [name, value] of Object.entries(values)) filled[name] = String(value);
  }
  return filled;
}

// -- the questions an if asks -------------------------------------------------------------------------------

async function holds(env: Env, runnable: Runnable, scope: Scope, step: Step): Promise<boolean> {
  const { ctx } = env;
  switch (step.type) {
    case "ifRole": {
      if (!step.ifRole) return false;
      const member = await memberById(ctx, scope.memberId);
      const has = member?.roles.cache.has(step.ifRole) ?? false;
      return step.ifHas === "hasNot" ? !has : has;
    }
    case "ifChannel": {
      if (!step.ifChannel) return false;
      const channel = scope.channelId ? ctx.guild.channels.cache.get(scope.channelId) : undefined;
      const within = placesOf(channel).includes(step.ifChannel);
      return step.ifIn === "notIn" ? !within : within;
    }
    case "ifWords":
      return matchesMessage(scope.vars.message ?? "", step.ifWords ?? [], step.ifWordMode ?? "contains");
    case "ifVariable": {
      if (!step.testName) return false;
      const kind = step.testScope ?? "member";
      const values = await readValues(ctx.guild.id, kind, scope.memberId, [step.testName]);
      return compare(values[step.testName] ?? 0, step.testHow ?? "atLeast", step.testAmount ?? 0);
    }
    case "ifChance":
      return check({ onlyChannels: [], onlyRoles: [], exceptRoles: [], chance: step.ifChance ?? 100 }, { channelIds: [], roleIds: [] }, Math.floor(Math.random() * 100)).ok;
    default:
      return false;
  }
}

// -- the steps that do something ----------------------------------------------------------------------------

/** One step. Resolves to a sentence about what went wrong, or null when it worked. */
async function perform(env: Env, runnable: Runnable, scope: Scope, step: Step): Promise<string | null> {
  const { ctx } = env;
  const reason = `Automation: ${runnable.name}`.slice(0, 200);
  switch (step.type) {
    case "message":
      return sendMessage(env, runnable, scope, step);

    case "role": {
      if (!step.role) return "a role step has no role picked";
      const member = await memberById(ctx, aimedAt(scope, step.roleTarget));
      if (!member) return "there is no member to change the role of";
      const role = ctx.guild.roles.cache.get(step.role);
      if (!role) return "the role no longer exists";
      const me = ctx.guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || !isRoleAssignable(role.position, me.roles.highest.position)) {
        return `I can't change ${role.name}, which needs Manage Roles and a role of mine above it`;
      }
      if (step.change === "take") await member.roles.remove(role, reason);
      else await member.roles.add(role, reason);
      return null;
    }

    case "react": {
      if (!step.emoji) return "a reaction step has no emoji picked";
      const message = await messageOf(ctx, scope);
      if (!message) return "there is no message to react to";
      await message.react(step.emoji);
      return null;
    }

    case "delete": {
      const message = await messageOf(ctx, scope);
      if (!message) return "there is no message to delete";
      await message.delete();
      return null;
    }

    case "pin": {
      const message = await messageOf(ctx, scope);
      if (!message) return "there is no message to pin";
      await message.pin(reason);
      return null;
    }

    case "thread": {
      const message = await messageOf(ctx, scope);
      if (!message) return "there is no message to start a thread on";
      if (message.hasThread) return "the message already has a thread";
      const vars = await withCounters(env, runnable, scope, step.threadName ?? "");
      const name = applyVariables(step.threadName ?? "", vars).trim().slice(0, 100) || "Discussion";
      await message.startThread({ name, reason });
      return null;
    }

    case "timeout": {
      const member = await memberById(ctx, aimedAt(scope, step.timeoutTarget));
      if (!member) return "there is no member to time out";
      if (!member.moderatable) return `I can't time out ${member.displayName}`;
      await member.timeout(Math.min(step.length ?? 600_000, MAX_TIMEOUT_MS), (step.reason ?? "Automation").slice(0, 200));
      return null;
    }

    case "nickname": {
      const member = await memberById(ctx, aimedAt(scope, step.nickTarget));
      if (!member) return "there is no member to rename";
      if (!member.manageable) return `I can't rename ${member.displayName}`;
      const vars = await withCounters(env, runnable, scope, step.nickname ?? "");
      const name = applyVariables(step.nickname ?? "", vars).trim().slice(0, 32);
      await member.setNickname(name === "" ? null : name, reason);
      return null;
    }

    case "voice": {
      if (!step.voiceTo) return "a voice step has no channel picked";
      const member = await memberById(ctx, aimedAt(scope, step.voiceTarget));
      if (!member) return "there is no member to move";
      if (!member.voice.channelId) return `${member.displayName} is not in a voice channel`;
      const channel = ctx.guild.channels.cache.get(step.voiceTo);
      if (!channel?.isVoiceBased()) return "the voice channel no longer exists";
      await member.voice.setChannel(channel, reason);
      return null;
    }

    case "variable": {
      if (!step.setName) return "a counter step has no counter named";
      const kind = step.setScope ?? "member";
      const now = await changeValue(ctx.guild.id, kind, scope.memberId, step.setName, step.setHow ?? "add", step.setAmount ?? 0);
      return now === null ? "a counter kept for each member has no member to count for" : null;
    }

    case "run": {
      if ((env.depth ?? 0) >= MAX_DEPTH) return "workflows run inside each other too deeply";
      const next = step.workflowName ? env.find(step.workflowName) : undefined;
      if (!next) return `there is no workflow named ${step.workflowName ?? ""}`.trim();
      const inner: Scope = { ...scope, workflowId: next.id, interaction: undefined, replied: false, problems: [] };
      await runSteps({ ...env, depth: (env.depth ?? 0) + 1 }, next, inner);
      if (inner.problems.length > 0) return `${next.name}: ${inner.problems[0]}`;
      return null;
    }

    default:
      return null;
  }
}

async function sendMessage(env: Env, runnable: Runnable, scope: Scope, step: Step): Promise<string | null> {
  const { ctx } = env;
  const body = step.message;
  if (!body) return "a message step has no message";
  const options = { fallback: STEP_MESSAGE };
  const vars = await withCounters(env, runnable, scope, body);

  if (step.where === "dm") {
    const member = await memberById(ctx, aimedAt(scope, step.dmTarget));
    if (!member) return "there is no member to send a direct message to";
    return (await ctx.send(member, body, vars, options)) ? null : "a direct message could not be delivered";
  }
  if (step.where !== "channel" && scope.interaction) {
    const sent = await ctx.reply(scope.interaction, body, vars, { ...options, ephemeral: runnable.reply !== "public" });
    if (sent) scope.replied = true;
    return sent ? null : "the reply could not be sent";
  }
  const target = step.where === "channel" ? step.channel : scope.channelId;
  const channel = target ? ctx.guild.channels.cache.get(target) : undefined;
  if (!channel?.isTextBased()) return "the channel for a message no longer exists";
  // Only the member and the roles the owner's own message names can be pinged, whatever a member typed into a value.
  const mentions = { users: scope.memberId ? [scope.memberId] : [], roles: rolesIn(body) };
  return (await ctx.send(channel, body, vars, { ...options, mentions })) ? null : "a message could not be sent";
}

/**
 * Runs the steps from the one given. An If that is not true skips to its Else or
 * its End if. A wait stores what is left as a task and stops here, so it survives
 * a restart and does not hold anything open.
 */
export async function runSteps(env: Env, runnable: Runnable, scope: Scope, from = 0): Promise<void> {
  const steps = runnable.steps;
  const layout = layoutOf(steps.map((step) => step.type));
  let index = from;
  let guard = 0;

  while (index < steps.length && guard < 500) {
    guard += 1;
    const step = steps[index]!;

    if (isIf(step.type)) {
      let yes = false;
      try {
        yes = await holds(env, runnable, scope, step);
      } catch (error) {
        scope.problems.push("a check could not be made");
        warn(`check step ${index + 1} of ${runnable.id}`)(error);
      }
      if (yes) index += 1;
      else {
        const otherwise = layout.elseOf[index]!;
        index = otherwise !== -1 ? otherwise + 1 : layout.endOf[index]! + 1;
      }
      continue;
    }
    if (step.type === "else") {
      // Reaching an Else means the If above was true, so the other branch is skipped.
      index = layout.matched[index] ? layout.endOf[index]! + 1 : index + 1;
      continue;
    }
    if (step.type === "endif") {
      index += 1;
      continue;
    }

    if (step.type === "wait") {
      if (index + 1 < steps.length) await env.ctx.tasks.schedule("resume", new Date(Date.now() + (step.pause ?? 30_000)), freeze(scope, index + 1)).catch(warn("queue the rest of a workflow"));
      return;
    }

    try {
      const problem = await perform(env, runnable, scope, step);
      if (problem) scope.problems.push(problem);
    } catch (error) {
      scope.problems.push("a step was refused by Discord");
      warn(`run step ${index + 1} of ${runnable.id}`)(error);
    }
    index += 1;
  }
  if ((env.depth ?? 0) === 0) for (const problem of scope.problems) console.warn(`[workflow] ${runnable.name}: ${problem}`);
}

/** What goes into a message for text someone else wrote. */
export const safe = (text: string, limit = 1000): string => defuse(text).slice(0, limit);
