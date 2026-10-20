import {
  AttachmentBuilder,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from "discord.js";
import type { CommandDefinition, ReplyValues } from "@tier0/core";
import { answer, hasAnyRole, memberOf, warn, type GamingCtx } from "./context.js";
import { SIGNUP_REPLIES, type SignupReplyKey } from "./messages.js";
import type { GamingSettings } from "./settings.js";
import { exportText } from "./signup-logic.js";
import { attachMessage, createEvent, discardEvent, entryOf, eventById, eventsOf, type EventWithEntries } from "./signup-store.js";
import { closeSignup, entriesOf, listed, refuse, scheduleReminder, sendSignup, valuesOf, withdrawEntry } from "./signup.js";
import { WHEN_EXAMPLES, parseWhen } from "./time.js";

/**
 * `/signup`: staff open a scrim or tournament sign-up and run it. Players use
 * the buttons on the post; everything here is for the people who organise.
 */

const SUGGESTIONS = 25;
const FILE_THRESHOLD = 1800;

function build(): ReturnType<CommandDefinition["build"]> {
  const event = (option: SlashCommandStringOption) =>
    option.setName("event").setDescription("The sign-up.").setRequired(true).setAutocomplete(true);
  return new SlashCommandBuilder()
    .setName("signup")
    .setDescription("Run scrim and tournament sign-ups.")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Open a sign-up.")
        .addStringOption((option) => option.setName("title").setDescription("What it is called.").setRequired(true).setMaxLength(100))
        .addStringOption((option) => option.setName("game").setDescription("The game.").setMaxLength(60))
        .addStringOption((option) => option.setName("start").setDescription("When it starts, such as 20:00, tomorrow 8pm or in 3h.").setMaxLength(60))
        .addIntegerOption((option) => option.setName("team-size").setDescription("Players to a team. 1 means players sign up alone.").setMinValue(1).setMaxValue(10))
        .addIntegerOption((option) => option.setName("max").setDescription("The most teams, or players when the team size is 1. Left out, no limit.").setMinValue(1).setMaxValue(500))
        .addBooleanOption((option) => option.setName("waitlist").setDescription("Keep a waitlist once it is full. On by default."))
        .addRoleOption((option) => option.setName("role").setDescription("A role players need to sign up."))
        .addRoleOption((option) => option.setName("or-role").setDescription("A second role that also lets someone sign up."))
        .addRoleOption((option) => option.setName("reward-role").setDescription("A role to give everyone who is registered."))
        .addStringOption((option) => option.setName("note").setDescription("Anything players should know.").setMaxLength(500))
        .addChannelOption((option) =>
          option.setName("channel").setDescription("Where to post it.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Stop taking sign-ups.")
        .addStringOption(event)
        .addBooleanOption((option) => option.setName("take-roles").setDescription("Take the reward role back from everyone.")),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show who is signed up.").addStringOption(event))
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Take a player, or their whole team, off a sign-up.")
        .addStringOption(event)
        .addUserOption((option) => option.setName("member").setDescription("Anyone on the entry.").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("export")
        .setDescription("Get the list as plain text.")
        .addStringOption(event)
        .addBooleanOption((option) => option.setName("public").setDescription("Post it in the channel for everyone to see.")),
    );
}

const say = (ctx: GamingCtx, interaction: ChatInputCommandInteraction, key: SignupReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.signupReplies[key], SIGNUP_REPLIES[key], values);

async function isStaff(ctx: GamingCtx, interaction: ChatInputCommandInteraction): Promise<boolean> {
  const permissions = interaction.memberPermissions;
  if (permissions?.has(PermissionFlagsBits.ManageEvents) || permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = ctx.settings.signups.staffRoles;
  if (roles.length === 0) return false;
  const member = await memberOf(ctx, interaction);
  return member ? hasAnyRole(member, roles) : false;
}

async function eventFrom(ctx: GamingCtx, interaction: ChatInputCommandInteraction): Promise<EventWithEntries | null> {
  const id = Number(/\d+/.exec(interaction.options.getString("event", true))?.[0]);
  const event = Number.isInteger(id) ? await eventById(ctx.guild.id, id) : null;
  if (!event) await refuse(ctx, interaction, "gone");
  return event;
}

async function create(ctx: GamingCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const start = interaction.options.getString("start");
  let startsAt: Date | null = null;
  if (start) {
    const parsed = parseWhen(start, new Date(), ctx.settings.timeZone);
    if (!parsed.ok) return refuse(ctx, interaction, "badTime", { examples: WHEN_EXAMPLES });
    startsAt = parsed.at;
  }

  const named = interaction.options.getChannel("channel");
  const configured = ctx.settings.signups.channel;
  const target = named?.id ?? configured;
  const channel = target ? (ctx.guild.channels.cache.get(target) ?? (await ctx.guild.channels.fetch(target).catch(() => null))) : interaction.channel;
  if (!channel?.isTextBased()) return refuse(ctx, interaction, "noChannel");

  const roles = ["role", "or-role"].flatMap((name) => interaction.options.getRole(name)?.id ?? []);
  const event = await createEvent({
    guildId: ctx.guild.id,
    channelId: channel.id,
    title: interaction.options.getString("title", true),
    game: interaction.options.getString("game") ?? "",
    note: interaction.options.getString("note") ?? "",
    startsAt,
    teamSize: interaction.options.getInteger("team-size") ?? 1,
    capacity: interaction.options.getInteger("max") ?? 0,
    waitlist: interaction.options.getBoolean("waitlist") ?? true,
    requiredRoles: roles,
    rewardRoleId: interaction.options.getRole("reward-role")?.id ?? null,
    createdById: interaction.user.id,
  });

  const message = await sendSignup(ctx, channel, event);
  if (!message) {
    await discardEvent(event.id);
    return refuse(ctx, interaction, "cannotPost");
  }
  await attachMessage(event.id, message.id);
  await scheduleReminder(ctx, event).catch(warn(`schedule the reminder of sign-up ${event.id}`));
  await say(ctx, interaction, "created", { id: event.id, link: message.url, title: event.title });
}

async function exportList(ctx: GamingCtx, interaction: ChatInputCommandInteraction, event: EventWithEntries): Promise<void> {
  const { registered, waiting } = entriesOf(event);
  const ids = [...new Set([...registered, ...waiting].flatMap((entry) => entry.members.map((member) => member.userId)))];
  // One request for everyone not already known, since the text names people rather than mentioning them.
  if (ids.some((id) => !ctx.guild.members.cache.has(id))) await ctx.guild.members.fetch({ user: ids }).catch(() => undefined);
  const text = exportText(
    event.title,
    event.teamSize,
    registered.map(listed),
    waiting.map(listed),
    (id) => ctx.guild.members.cache.get(id)?.displayName ?? id,
    ctx.settings.signups.labels.waitlistHeading,
  );
  const options = text.length <= FILE_THRESHOLD ? { content: "```\n" + text + "\n```" } : { files: [new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `signup-${event.id}.txt` })] };
  await interaction.editReply({ ...options, allowedMentions: { parse: [] } });
}

async function run(interaction: ChatInputCommandInteraction, ctx: GamingCtx): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const open = sub === "export" && interaction.options.getBoolean("public") === true;
  // Checked before deferring, so a refusal is private even when the reply asked for would have been public.
  if (!(await isStaff(ctx, interaction))) return refuse(ctx, interaction, "notStaff");
  await interaction.deferReply(open ? {} : { flags: MessageFlags.Ephemeral });
  if (sub === "create") return create(ctx, interaction);

  const event = await eventFrom(ctx, interaction);
  if (!event) return;

  switch (sub) {
    case "close": {
      if (!(await closeSignup(ctx, event, interaction.options.getBoolean("take-roles") === true))) return refuse(ctx, interaction, "closedAlready");
      return say(ctx, interaction, "closed", { id: event.id, title: event.title });
    }
    case "list":
      return void (await ctx.reply(interaction, ctx.settings.messages.signupReplies.list, valuesOf(event), { fallback: SIGNUP_REPLIES.list.starting }));
    case "remove": {
      const user = interaction.options.getUser("member", true);
      const entry = await entryOf(event.id, user.id);
      if (!entry) return refuse(ctx, interaction, "noEntry", { member: `<@${user.id}>` });
      const removed = await withdrawEntry(ctx, event, entry.id);
      if (!removed) return refuse(ctx, interaction, "noEntry", { member: `<@${user.id}>` });
      return say(ctx, interaction, "removed", { id: event.id, players: removed.members.map((member) => `<@${member.userId}>`).join(" ") });
    }
    case "export":
      return exportList(ctx, interaction, event);
  }
}

async function autocomplete(interaction: AutocompleteInteraction, ctx: GamingCtx): Promise<void> {
  const typed = interaction.options.getFocused().trim().toLowerCase();
  const open = interaction.options.getSubcommand(false) === "close";
  const events = await eventsOf(ctx.guild.id, open ? "open" : undefined);
  const matches = events
    .filter((event) => typed === "" || event.title.toLowerCase().includes(typed) || String(event.id).startsWith(typed.replace("#", "")))
    .slice(0, SUGGESTIONS)
    .map((event) => ({ name: `#${event.id} ${event.title}`.slice(0, 100), value: String(event.id) }));
  await interaction.respond(matches);
}

export const signupCommand: CommandDefinition<GamingSettings> = {
  name: "signup",
  description: "Run scrim and tournament sign-ups.",
  build,
  run,
  autocomplete,
  variedReply: true,
};
