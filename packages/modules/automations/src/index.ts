import { defineModule, type EventHandlers, type TaskHandler } from "@tier0/core";
import { fire, matchesMessage, nextRun, runSteps, sameEmoji, scopeForNobody, thaw, warn, type Cause, type Ctx, type Env, type Gated, type MatchMode, type Runnable } from "@tier0/workflow";
import { settingsSchema, type AutomationSettings, type Workflow } from "./settings.js";

/**
 * Workflows: something happens, the member and place pass the checks, and a list
 * of steps runs. The engine is shared with Custom commands, see @tier0/workflow.
 */

type Flow = Runnable & Gated;

const asFlow = (workflow: Workflow): Flow => workflow as unknown as Flow;

const active = (ctx: Ctx, trigger: Workflow["trigger"]): Workflow[] => (ctx.settings as AutomationSettings).workflows.filter((workflow) => workflow.enabled && workflow.trigger === trigger && workflow.steps.length > 0);

/** What a run needs besides the server: how to find another workflow by its name. */
function envOf(ctx: Ctx): Env {
  const workflows = (ctx.settings as AutomationSettings).workflows;
  return { ctx, find: (name) => workflows.filter((workflow) => workflow.enabled).map(asFlow).find((workflow) => workflow.name === name) };
}

async function fireAll(ctx: Ctx, flows: Workflow[], cause: Cause): Promise<void> {
  const env = envOf(ctx);
  for (const workflow of flows) await fire(env, asFlow(workflow), cause);
}

const events: Partial<EventHandlers<AutomationSettings>> = {
  async messageCreate(message, ctx) {
    if (!message.guild || message.author.bot || message.content === "") return;
    const flows = active(ctx, "message").filter((workflow) => workflow.phrases.length > 0 && matchesMessage(message.content, workflow.phrases, workflow.matchMode as MatchMode));
    if (flows.length === 0) return;
    const member = message.member ?? (await ctx.guild.members.fetch(message.author.id).catch(() => null));
    const channel = message.channel.isDMBased() ? null : message.channel;
    await fireAll(ctx, flows, { member, user: message.author, channel, message });
  },

  async memberJoin(member, ctx) {
    if (member.user.bot) return;
    await fireAll(ctx, active(ctx, "memberJoin"), { member, user: member.user, channel: null, message: null });
  },

  async memberLeave(member, ctx) {
    const user = member.user;
    if (!user || user.bot) return;
    await fireAll(ctx, active(ctx, "memberLeave"), { member, user, channel: null, message: null });
  },

  async memberUpdate(before, after, ctx) {
    if (before.partial || after.user.bot) return;

    for (const workflow of active(ctx, "role").filter((entry) => entry.watchedRole)) {
      const id = workflow.watchedRole!;
      const had = before.roles.cache.has(id);
      const has = after.roles.cache.has(id);
      if (had === has || (workflow.roleChange === "gained") !== has) continue;
      const role = ctx.guild.roles.cache.get(id);
      await fireAll(ctx, [workflow], { member: after, user: after.user, channel: null, message: null, extra: { role: role?.name ?? "", roleMention: `<@&${id}>` } });
    }

    if (!before.premiumSinceTimestamp && after.premiumSinceTimestamp) {
      await fireAll(ctx, active(ctx, "boost"), { member: after, user: after.user, channel: null, message: null });
    }
  },

  async reactionAdd(reaction, user, ctx) {
    const flows = active(ctx, "reaction");
    if (flows.length === 0) return;
    const full = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
    if (!full) return;
    const message = full.message.partial ? await full.message.fetch().catch(() => null) : full.message;
    if (!message?.guild) return;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    const who = user.partial ? await user.fetch().catch(() => null) : user;
    if (!who) return;
    const channel = message.channel.isDMBased() ? null : message.channel;
    const emoji = full.emoji.id ? `<${full.emoji.animated ? "a" : ""}:${full.emoji.name}:${full.emoji.id}>` : (full.emoji.name ?? "");
    const author = message.author ? { id: message.author.id, name: message.member?.displayName ?? message.author.username } : null;
    const matching = flows.filter((workflow) => !workflow.reactionEmoji || sameEmoji(workflow.reactionEmoji, full.emoji));
    await fireAll(ctx, matching, { member, user: who, channel, message, author, extra: { emoji } });
  },

  async voiceStateUpdate(before, after, ctx) {
    if (before.channelId === after.channelId) return;
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const joined = after.channelId !== null;
    const left = before.channelId !== null && after.channelId === null;
    const flows = active(ctx, "voice").filter((workflow) => (workflow.voiceChange === "joined" ? joined : left));
    await fireAll(ctx, flows, { member, user: member.user, channel: (joined ? after.channel : before.channel) ?? null, message: null });
  },

  async threadCreate(thread, ctx) {
    const flows = active(ctx, "thread");
    if (flows.length === 0 || !thread.ownerId) return;
    const member = await ctx.guild.members.fetch(thread.ownerId).catch(() => null);
    if (!member || member.user.bot) return;
    await fireAll(ctx, flows, { member, user: member.user, channel: thread, message: null });
  },

  async banAdd(ban, ctx) {
    if (ban.user.bot) return;
    await fireAll(ctx, active(ctx, "ban"), { member: null, user: ban.user, channel: null, message: null });
  },
};

// -- schedules ----------------------------------------------------------------------------------------------

function whenNext(workflow: Workflow, zone: string, after = Date.now()): number | null {
  return nextRun(after, { every: workflow.every as "hour" | "day" | "week", time: workflow.time, weekday: Number(workflow.weekday) }, zone);
}

/** Puts every schedule that is on in the queue again, from now. The queue outlives the bot, so this only has to run when settings change. */
async function scheduleAll(ctx: Ctx): Promise<void> {
  const settings = ctx.settings as AutomationSettings;
  await ctx.tasks.cancel("scheduled");
  for (const workflow of active(ctx, "schedule")) {
    const next = whenNext(workflow, settings.timeZone);
    if (next !== null) await ctx.tasks.schedule("scheduled", new Date(next), { workflowId: workflow.id });
  }
}

const tasks: Record<string, TaskHandler<AutomationSettings>> = {
  /** Carries on with a workflow that was told to wait. A workflow that was removed or switched off in the meantime stops. */
  async resume(payload, ctx) {
    const frozen = thaw(payload);
    if (!frozen) return;
    const workflow = ctx.settings.workflows.find((entry) => entry.id === frozen.scope.workflowId);
    if (!workflow?.enabled) return;
    await runSteps(envOf(ctx), asFlow(workflow), frozen.scope, frozen.from).catch(warn(`resume workflow ${workflow.id}`));
  },

  /** A schedule came due: run it, and queue the next time. */
  async scheduled(payload, ctx) {
    const workflow = ctx.settings.workflows.find((entry) => entry.id === payload.workflowId);
    if (!workflow?.enabled || workflow.trigger !== "schedule" || workflow.steps.length === 0) return;
    const next = whenNext(workflow, ctx.settings.timeZone);
    if (next !== null) await ctx.tasks.schedule("scheduled", new Date(next), { workflowId: workflow.id });
    const flow = asFlow(workflow);
    await runSteps(envOf(ctx), flow, scopeForNobody(flow)).catch(warn(`run scheduled workflow ${workflow.id}`));
  },
};

export default defineModule({
  id: "automations",
  name: "Automations",
  summary: "Run steps when something happens, such as a member joining, a message saying a word or a time of day.",
  category: "utility",
  requires: ["ManageRoles", "ManageNicknames", "ManageMessages", "ModerateMembers", "MoveMembers", "AddReactions", "CreatePublicThreads"],

  settings: settingsSchema,
  events,
  tasks,

  async onEnable(ctx) {
    await scheduleAll(ctx as Ctx).catch(warn("queue the schedules"));
  },

  async onDisable(ctx) {
    await ctx.tasks.cancel("scheduled").catch(warn("clear the schedules"));
  },

  async onSettingsChange(ctx) {
    await scheduleAll(ctx as Ctx).catch(warn("queue the schedules"));
  },
});
