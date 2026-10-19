import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type Message,
  type MessageActionRowComponentBuilder,
  type TextBasedChannel,
} from "discord.js";
import { customId, type ComponentHandler, type ModalHandler, type ReplyValues } from "@tier0/core";
import { answer, roleMentions, warn, type Answerable, type GamingCtx } from "./context.js";
import {
  SIGNUP_CLOSED,
  SIGNUP_POST,
  SIGNUP_PROMOTED,
  SIGNUP_REFUSALS,
  SIGNUP_REMINDER,
  SIGNUP_REPLIES,
  type SignupRefusalKey,
  type SignupReplyKey,
} from "./messages.js";
import type { GamingSettings } from "./settings.js";
import { meetsRoles, teamOf, type ListedEntry } from "./signup-logic.js";
import {
  closeEvent,
  entryOf,
  eventById,
  markReminded,
  register,
  removeTeammate,
  requiredRolesOf,
  withdraw,
  type EntryWithMembers,
  type EventWithEntries,
} from "./signup-store.js";
import { signupValues } from "./values.js";

/**
 * Sign-ups as they live in Discord: the post and its buttons, the form a team
 * captain fills in, the reward role, and the notices sent when a place opens
 * or the start is near.
 */

const REMINDER_CHUNK = 80;

export const listed = (entry: EntryWithMembers): ListedEntry => ({
  captainId: entry.captainId,
  teamName: entry.teamName,
  members: entry.members.map((member) => member.userId),
});

export function entriesOf(event: EventWithEntries): { registered: EntryWithMembers[]; waiting: EntryWithMembers[] } {
  return {
    registered: event.entries.filter((entry) => entry.status === "registered"),
    waiting: event.entries.filter((entry) => entry.status === "waitlist"),
  };
}

export function valuesOf(event: EventWithEntries): ReplyValues {
  const { registered, waiting } = entriesOf(event);
  return signupValues(event, registered.map(listed), waiting.map(listed));
}

export const eventRows = (ctx: GamingCtx, event: EventWithEntries): ActionRowBuilder<MessageActionRowComponentBuilder>[] => {
  if (event.status !== "open") return [];
  const { signupJoin, signupLeave } = ctx.settings.labels;
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(customId("gaming", "signupJoin", String(event.id))).setLabel(signupJoin).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(customId("gaming", "signupLeave", String(event.id))).setLabel(signupLeave).setStyle(ButtonStyle.Secondary),
    ),
  ];
};

export function sendSignup(ctx: GamingCtx, channel: TextBasedChannel, event: EventWithEntries): Promise<Message | null> {
  return ctx.send(channel, ctx.settings.messages.signupPost, valuesOf(event), { fallback: SIGNUP_POST, rows: eventRows(ctx, event), mentions: { users: [], roles: [] } });
}

async function messageOf(ctx: GamingCtx, event: EventWithEntries): Promise<Message | null> {
  if (!event.messageId) return null;
  const channel = ctx.guild.channels.cache.get(event.channelId) ?? (await ctx.guild.channels.fetch(event.channelId).catch(() => null));
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(event.messageId).catch(() => null);
}

/** Rewrites the sign-up's post to match the entries as they stand now. */
export async function refreshSignup(ctx: GamingCtx, event: EventWithEntries, known?: Message | null): Promise<void> {
  const message = known ?? (await messageOf(ctx, event));
  if (!message) return;
  const open = event.status === "open";
  await ctx.edit(message, open ? ctx.settings.messages.signupPost : ctx.settings.messages.signupClosed, valuesOf(event), {
    fallback: open ? SIGNUP_POST : SIGNUP_CLOSED,
    rows: eventRows(ctx, event),
  });
}

/** Schedules the reminder, if reminders are on and there is still time before the start. */
export async function scheduleReminder(ctx: GamingCtx, event: { id: number; startsAt: Date | null }): Promise<void> {
  const lead = ctx.settings.signups.remindBefore;
  if (!event.startsAt || lead <= 0) return;
  const at = new Date(event.startsAt.getTime() - lead);
  if (at.getTime() <= Date.now()) return;
  await ctx.tasks.schedule("signupReminder", at, { eventId: event.id });
}

async function reload(ctx: GamingCtx, id: number): Promise<EventWithEntries | null> {
  return eventById(ctx.guild.id, id);
}

// -- roles and notices -------------------------------------------------------

async function setRewardRole(ctx: GamingCtx, event: EventWithEntries, userIds: string[], give: boolean): Promise<void> {
  if (!event.rewardRoleId) return;
  for (const id of userIds) {
    const member = await ctx.guild.members.fetch(id).catch(() => null);
    if (!member) continue;
    const reason = event.title.slice(0, 100);
    if (give) await member.roles.add(event.rewardRoleId, reason).catch(warn(`give the role of sign-up ${event.id} to ${id}`));
    else await member.roles.remove(event.rewardRoleId, reason).catch(warn(`take the role of sign-up ${event.id} from ${id}`));
  }
}

const idsOf = (entries: EntryWithMembers[]) => entries.flatMap((entry) => entry.members.map((member) => member.userId));

const mentionIds = (ids: string[]) => ids.map((id) => `<@${id}>`).join(" ");

function noticeValues(event: EventWithEntries, ids: string[], link: string): ReplyValues {
  const base = valuesOf(event);
  return { title: event.title, players: mentionIds(ids), starts: String(base.starts ?? ""), link };
}

async function tellPromoted(ctx: GamingCtx, event: EventWithEntries, promoted: EntryWithMembers[]): Promise<void> {
  const mode = ctx.settings.signups.promotion;
  const channel = ctx.guild.channels.cache.get(event.channelId);
  const link = event.messageId ? `https://discord.com/channels/${ctx.guild.id}/${event.channelId}/${event.messageId}` : "";
  for (const entry of promoted) {
    const ids = entry.members.map((member) => member.userId);
    const values = noticeValues(event, ids, link);
    let unreached = ids;
    if (mode !== "channel") {
      const missed: string[] = [];
      for (const id of ids) {
        const user = await ctx.client.users.fetch(id).catch(() => null);
        const sent = user ? await ctx.send(user, ctx.settings.messages.signupPromoted, values, { fallback: SIGNUP_PROMOTED }) : null;
        if (!sent) missed.push(id);
      }
      // Closed direct messages fall back to the channel, so nobody is left not knowing.
      unreached = mode === "dm" ? missed : ids;
    }
    if (unreached.length === 0 || !channel?.isTextBased()) continue;
    await ctx.send(channel, ctx.settings.messages.signupPromoted, { ...values, players: mentionIds(unreached) }, { fallback: SIGNUP_PROMOTED, mentions: { users: unreached, roles: [] } });
  }
}

/** Takes an entry off, hands its places to the waitlist, and brings the post and the roles up to date. */
export async function withdrawEntry(ctx: GamingCtx, event: EventWithEntries, entryId: number, known?: Message | null): Promise<EntryWithMembers | null> {
  const outcome = await withdraw(event.id, entryId);
  if (!outcome) return null;
  if (outcome.removed.status === "registered") await setRewardRole(ctx, event, idsOf([outcome.removed]), false);
  await setRewardRole(ctx, event, idsOf(outcome.promoted), true);
  const fresh = await reload(ctx, event.id);
  if (fresh) {
    await refreshSignup(ctx, fresh, known);
    await tellPromoted(ctx, fresh, outcome.promoted);
  }
  return outcome.removed;
}

/** Stops the sign-up. With `takeRoles`, the reward role is taken back from everyone who has it. */
export async function closeSignup(ctx: GamingCtx, event: EventWithEntries, takeRoles: boolean): Promise<boolean> {
  if (!(await closeEvent(event.id))) return false;
  await ctx.tasks.cancel("signupReminder", { eventId: event.id });
  if (takeRoles) await setRewardRole(ctx, event, idsOf(entriesOf(event).registered), false);
  const fresh = await reload(ctx, event.id);
  if (fresh) await refreshSignup(ctx, fresh);
  return true;
}

/** Pings the registered players shortly before the start. */
export async function remind(ctx: GamingCtx, id: number): Promise<void> {
  const event = await reload(ctx, id);
  if (!event || event.status !== "open" || !(await markReminded(id))) return;
  const ids = idsOf(entriesOf(event).registered);
  const channel = ctx.guild.channels.cache.get(event.channelId);
  if (ids.length === 0 || !channel?.isTextBased()) return;
  const link = event.messageId ? `https://discord.com/channels/${ctx.guild.id}/${event.channelId}/${event.messageId}` : "";
  for (let start = 0; start < ids.length; start += REMINDER_CHUNK) {
    const chunk = ids.slice(start, start + REMINDER_CHUNK);
    await ctx.send(channel, ctx.settings.messages.signupReminder, noticeValues(event, chunk, link), {
      fallback: SIGNUP_REMINDER,
      mentions: { users: chunk, roles: [] },
    });
  }
}

// -- signing up --------------------------------------------------------------

const say = (ctx: GamingCtx, interaction: Answerable, key: SignupReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.signupReplies[key], SIGNUP_REPLIES[key], values);

export const refuse = (ctx: GamingCtx, interaction: Answerable, key: SignupRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.signupRefusals[key], SIGNUP_REFUSALS[key], values);

/**
 * Checks everyone on an entry, registers it, and answers. The interaction has
 * already been deferred. `members` starts with the captain.
 */
async function signUp(
  ctx: GamingCtx,
  interaction: Answerable,
  event: EventWithEntries,
  members: string[],
  teamName: string,
  known: Message | null,
): Promise<void> {
  const required = requiredRolesOf(event);
  for (const id of members) {
    const person: GuildMember | null = await ctx.guild.members.fetch(id).catch(() => null);
    if (!person) return refuse(ctx, interaction, "memberNotFound", { id });
    if (person.user.bot) return refuse(ctx, interaction, "botMember");
    if (!meetsRoles(person.roles.cache.keys(), required)) {
      return refuse(ctx, interaction, "missingRole", { member: `<@${id}>`, roles: roleMentions(required) });
    }
  }

  const result = await register(ctx.guild.id, event.id, members, teamName);
  if (!result.ok) {
    if (result.code === "taken") return refuse(ctx, interaction, "alreadyIn", { member: `<@${result.userId ?? members[0]}>` });
    if (result.code === "full") return refuse(ctx, interaction, "full", { title: event.title });
    return refuse(ctx, interaction, result.code === "closed" ? "closedAlready" : "gone");
  }

  const { entry, placement } = result;
  if (placement === "registered") await setRewardRole(ctx, event, members, true);
  const fresh = await reload(ctx, event.id);
  if (fresh) await refreshSignup(ctx, fresh, known);
  const players = mentionIds(members);
  if (placement === "registered") return say(ctx, interaction, "registered", { title: event.title, players });
  const position = fresh ? entriesOf(fresh).waiting.findIndex((waiting) => waiting.id === entry.id) + 1 : 1;
  return say(ctx, interaction, "waitlisted", { title: event.title, position, players });
}

const eventIdOf = (rest: string) => {
  const id = Number(rest);
  return Number.isInteger(id) ? id : null;
};

export const signupComponents: Record<string, ComponentHandler<GamingSettings>> = {
  async signupJoin(interaction, { rest, ctx }) {
    const id = eventIdOf(rest);
    const event = id === null ? null : await reload(ctx, id);
    if (!event) return replyEphemeral(ctx, interaction, "gone");
    if (event.status !== "open") return replyEphemeral(ctx, interaction, "closedAlready");
    if (await entryOf(event.id, interaction.user.id)) return replyEphemeral(ctx, interaction, "alreadyIn", { member: `<@${interaction.user.id}>` });

    if (event.teamSize > 1) {
      // A form has to be the first thing said to the interaction, so everything above is a read.
      await interaction.showModal(teamForm(ctx, event));
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await signUp(ctx, interaction, event, [interaction.user.id], "", interaction.message);
  },

  async signupLeave(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = eventIdOf(rest);
    const event = id === null ? null : await reload(ctx, id);
    if (!event) return refuse(ctx, interaction, "gone");
    if (event.status !== "open") return refuse(ctx, interaction, "closedAlready");
    const entry = await entryOf(event.id, interaction.user.id);
    if (!entry) return refuse(ctx, interaction, "notRegistered");
    if (entry.captainId !== interaction.user.id) {
      // A captain can name anyone, so a teammate has to be able to take themselves off. The team carries on without them.
      if (!(await removeTeammate(event.id, entry.id, interaction.user.id))) return refuse(ctx, interaction, "notRegistered");
      await setRewardRole(ctx, event, [interaction.user.id], false);
      const fresh = await reload(ctx, event.id);
      if (fresh) await refreshSignup(ctx, fresh, interaction.message);
      return say(ctx, interaction, "withdrawn", { title: event.title });
    }
    if (!(await withdrawEntry(ctx, event, entry.id, interaction.message))) return refuse(ctx, interaction, "notRegistered");
    await say(ctx, interaction, "withdrawn", { title: event.title });
  },
};

async function replyEphemeral(ctx: GamingCtx, interaction: Answerable, key: SignupRefusalKey, values: ReplyValues = {}): Promise<void> {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refuse(ctx, interaction, key, values);
}

function teamForm(ctx: GamingCtx, event: EventWithEntries): ModalBuilder {
  const { formTitle, teamNameLabel, teamNamePlaceholder, teammatesLabel, teammatesPlaceholder } = ctx.settings.labels;
  return new ModalBuilder()
    .setCustomId(customId("gaming", "signupTeam", String(event.id)))
    .setTitle(formTitle)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("team")
          .setLabel(teamNameLabel)
          .setPlaceholder(teamNamePlaceholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("mates")
          .setLabel(teammatesLabel)
          .setPlaceholder(teammatesPlaceholder)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(event.teamSize > 1 && ctx.settings.signups.fullTeamsOnly)
          .setMaxLength(1000),
      ),
    );
}

export const signupModals: Record<string, ModalHandler<GamingSettings>> = {
  async signupTeam(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = eventIdOf(rest);
    const event = id === null ? null : await reload(ctx, id);
    if (!event) return refuse(ctx, interaction, "gone");
    if (event.status !== "open") return refuse(ctx, interaction, "closedAlready");

    const team = teamOf(interaction.user.id, interaction.fields.getTextInputValue("mates"), event.teamSize, ctx.settings.signups.fullTeamsOnly);
    if (!team.ok) {
      if (team.code === "tooMany") return refuse(ctx, interaction, "tooMany", { teamSize: event.teamSize });
      const named = teamOf(interaction.user.id, interaction.fields.getTextInputValue("mates"), event.teamSize, false);
      const have = named.ok ? named.members.length : 1;
      return refuse(ctx, interaction, "tooFew", { teamSize: event.teamSize, missing: event.teamSize - have });
    }
    const name = interaction.fields.getTextInputValue("team").trim();
    await signUp(ctx, interaction, event, team.members, name, interaction.message ?? null);
  },
};
