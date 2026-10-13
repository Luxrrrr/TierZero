import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIInteractionGuildMember,
  type GuildMember,
  type Message,
  type PermissionsBitField,
  type TextBasedChannel,
} from "discord.js";
import { customId, defineModule, s, type Infer, type ModuleContext } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { canManageTicket, evaluateOpenRequest } from "./policy.js";
import { ticketChannelName } from "./naming.js";
import {
  ADDED_MESSAGE,
  CLOSING_MESSAGE,
  CLOSING_VARIABLES,
  CREATED_MESSAGE,
  CREATED_VARIABLES,
  MEMBER_VARIABLES,
  OPENED_MESSAGE,
  OPENED_VARIABLES,
  PANEL_MESSAGE,
  PANEL_POSTED_MESSAGE,
  PANEL_POSTED_VARIABLES,
  REMOVED_MESSAGE,
  TRANSCRIPT_MESSAGE,
  TRANSCRIPT_VARIABLES,
  closingValues,
  openedValues,
  transcriptValues,
  upgradePanel,
} from "./messages.js";
import { renderTranscript, type TranscriptMessage } from "./transcript.js";

const CATEGORY_CHILD_LIMIT = 50;
const MESSAGE_FETCH_CAP = 500;

const settingsSchema = s.object({
  panel: s.object(
    {
      channel: s.channel({
        types: ["text"],
        optional: true,
        essential: true,
        label: "Panel channel",
        help: "Where the ticket panel is posted. Until this is set there is nowhere to publish it.",
      }),
      message: s.message({
        label: "Panel message",
        note: "The button members press to open a ticket is added under this message for you.",
        starting: PANEL_MESSAGE,
        components: false,
      }),
      buttonLabel: s.string({ label: "Button label", default: "Open a ticket", max: 80 }),
      buttonEmoji: s.emoji({ label: "Button emoji", optional: true }),
    },
    { label: "The panel members press", upgrade: upgradePanel },
  ),
  category: s.channel({
    types: ["category"],
    optional: true,
    essential: true,
    label: "Ticket category",
    help: "New ticket channels are created under this category. Tickets cannot be opened until it is set.",
  }),
  supportRoles: s.array(s.role(), {
    guided: true,
    label: "Support roles",
    help: "Roles that can see every ticket and manage them.",
    min: 1,
  }),
  ticketLimit: s.integer({
    label: "Max open tickets per member",
    help: "How many tickets one member may have open at the same time.",
    default: 1,
    min: 1,
    max: 10,
  }),
  transcript: s.object(
    {
      enabled: s.boolean({
        label: "Save a transcript when a ticket closes",
        default: true,
        guided: true,
      }),
      channel: s.channel({
        types: ["text"],
        label: "Transcript channel",
        help: "Where closed ticket transcripts are posted.",
        optional: true,
        guided: true,
        when: { field: "enabled", equals: true },
      }),
      message: s.message({
        label: "Transcript message",
        note: "The transcript itself is attached to this message as a text file.",
        starting: TRANSCRIPT_MESSAGE,
        variables: TRANSCRIPT_VARIABLES,
        components: false,
        when: { field: "enabled", equals: true },
      }),
    },
    { label: "Transcripts" },
  ),
  messages: s.object(
    {
      opened: s.message({
        label: "First message in a new ticket",
        note: "Mentions in it are real pings, so keep {supportRoles} in the text if the support team should be notified. The Close ticket button is added under it for you.",
        starting: OPENED_MESSAGE,
        variables: OPENED_VARIABLES,
        components: false,
      }),
      created: s.message({
        label: "Reply to the member who opened a ticket",
        note: "Only the member who opened the ticket sees this.",
        starting: CREATED_MESSAGE,
        variables: CREATED_VARIABLES,
        delivery: "dm",
        components: false,
      }),
      closing: s.message({
        label: "When a ticket is being closed",
        note: "Posted in the ticket by the Close ticket button and by /ticket close.",
        starting: CLOSING_MESSAGE,
        variables: CLOSING_VARIABLES,
        components: false,
      }),
      added: s.message({
        label: "When a member is added with /ticket add",
        starting: ADDED_MESSAGE,
        variables: MEMBER_VARIABLES,
        components: false,
      }),
      removed: s.message({
        label: "When a member is removed with /ticket remove",
        starting: REMOVED_MESSAGE,
        variables: MEMBER_VARIABLES,
        components: false,
      }),
      panelPosted: s.message({
        label: "After /ticket panel posts the panel",
        note: "Only the person who ran the command sees this.",
        starting: PANEL_POSTED_MESSAGE,
        variables: PANEL_POSTED_VARIABLES,
        delivery: "dm",
        components: false,
      }),
    },
    { label: "Other messages" },
  ),
  autoClose: s.object(
    {
      enabled: s.boolean({ label: "Auto-close inactive tickets", default: false }),
      after: s.duration({
        label: "Close after this much inactivity",
        default: "24h",
        max: "7d",
        when: { field: "enabled", equals: true },
      }),
    },
    { label: "Inactivity" },
  ),
});

type TicketSettings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<TicketSettings>;

function panelRow(settings: TicketSettings) {
  const button = new ButtonBuilder()
    .setCustomId(customId("tickets", "open"))
    .setLabel(settings.panel.buttonLabel)
    .setStyle(ButtonStyle.Primary);
  if (settings.panel.buttonEmoji) button.setEmoji(settings.panel.buttonEmoji);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function memberRoleIds(member: GuildMember | APIInteractionGuildMember | null | undefined): string[] {
  if (!member) return [];
  return "cache" in member.roles ? [...member.roles.cache.keys()] : member.roles;
}

interface InteractionActor {
  user: { id: string };
  member: GuildMember | APIInteractionGuildMember | null;
  memberPermissions: PermissionsBitField | null;
}

function hasManageChannels(interaction: InteractionActor): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
}

/** A support role holder or someone with Manage Channels, regardless of any particular ticket. */
function isSupportStaff(interaction: InteractionActor, settings: TicketSettings): boolean {
  return canManageTicket(
    { id: interaction.user.id, isOpener: false, roleIds: memberRoleIds(interaction.member), hasManageChannels: hasManageChannels(interaction) },
    settings.supportRoles,
  );
}

/** Support staff, plus the ticket's own opener unless `staffOnly` is set. */
function canManageThisTicket(
  interaction: InteractionActor,
  settings: TicketSettings,
  ticket: { openerId: string },
  staffOnly = false,
): boolean {
  return canManageTicket(
    {
      id: interaction.user.id,
      isOpener: !staffOnly && interaction.user.id === ticket.openerId,
      roleIds: memberRoleIds(interaction.member),
      hasManageChannels: hasManageChannels(interaction),
    },
    settings.supportRoles,
  );
}

async function fetchMessageHistory(channel: TextBasedChannel): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;
  while (collected.length < MESSAGE_FETCH_CAP) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function saveTranscript(ctx: Ctx, ticket: Ticket, closedAt: Date, closedBy: { id: string; tag: string }, channel: TextBasedChannel): Promise<void> {
  const destinationId = ctx.settings.transcript.channel;
  if (!destinationId) {
    console.warn(`[tickets] transcript enabled but no transcript channel is configured for guild ${ctx.guild.id}`);
    return;
  }
  const destination = ctx.guild.channels.cache.get(destinationId);
  if (!destination?.isTextBased()) {
    console.warn(`[tickets] transcript channel ${destinationId} is missing or not text-based (guild ${ctx.guild.id})`);
    return;
  }

  const history = await fetchMessageHistory(channel).catch(() => []);
  const opener = await ctx.guild.members.fetch(ticket.openerId).catch(() => null);

  const messages: TranscriptMessage[] = history.map((message) => ({
    authorTag: message.author?.tag ?? "unknown user",
    authorId: message.author?.id ?? "unknown",
    timestamp: message.createdTimestamp,
    content: message.content || null,
    attachmentUrls: [...message.attachments.values()].map((attachment) => attachment.url),
  }));

  const transcript = renderTranscript(
    {
      guildName: ctx.guild.name,
      channelName: "name" in channel ? (channel.name ?? "ticket") : "ticket",
      ticketId: ticket.id,
      openerTag: opener?.user.tag ?? ticket.openerId,
      subject: ticket.subject,
      openedAt: ticket.openedAt.getTime(),
      closedAt: closedAt.getTime(),
      closedByTag: closedBy.tag,
    },
    messages,
  );

  const posted = await ctx.send(
    destination,
    ctx.settings.transcript.message,
    transcriptValues(ticket, closedBy, "name" in channel ? (channel.name ?? "ticket") : "ticket"),
    {
      fallback: TRANSCRIPT_MESSAGE,
      files: [new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `ticket-${ticket.id}.txt` })],
    },
  );
  if (!posted) console.error(`[tickets] failed to post the transcript for ticket ${ticket.id}`);
}

/**
 * Closes a ticket: cancels any pending auto-close, saves a transcript if
 * configured, marks the row closed, and removes the channel. Every step
 * tolerates the channel already being gone, since this runs from a scheduled
 * task as well as a live interaction and the two can race.
 */
async function closeTicket(ctx: Ctx, ticket: Ticket, closedBy: { id: string; tag: string }): Promise<void> {
  await ctx.tasks.cancel("autoclose", { channelId: ticket.channelId });

  const closedAt = new Date();
  await prisma.ticket
    .update({ where: { id: ticket.id }, data: { status: "closed", closedAt, closedBy: closedBy.id } })
    .catch(() => undefined);

  const channel = ctx.guild.channels.cache.get(ticket.channelId);
  const textChannel = channel?.isTextBased() ? channel : null;

  if (ctx.settings.transcript.enabled && textChannel) {
    await saveTranscript(ctx, ticket, closedAt, closedBy, textChannel);
  }

  if (channel) {
    await channel.delete(`Ticket closed by ${closedBy.tag}`).catch((error: unknown) => {
      console.error(`[tickets] failed to delete ticket channel ${ticket.channelId}:`, error);
    });
  }
}

async function openRequestDecision(ctx: Ctx, openerId: string) {
  const [openCount, category] = await Promise.all([
    prisma.ticket.count({ where: { guildId: ctx.guild.id, openerId, status: "open" } }),
    Promise.resolve(ctx.guild.channels.cache.get(ctx.settings.category)),
  ]);
  const categoryExists = category?.type === ChannelType.GuildCategory;
  const categoryChildCount = categoryExists
    ? ctx.guild.channels.cache.filter((c) => c.parentId === category.id).size
    : 0;
  return evaluateOpenRequest({
    openCount,
    limit: ctx.settings.ticketLimit,
    categoryExists,
    categoryChildCount: Math.min(categoryChildCount, CATEGORY_CHILD_LIMIT),
  });
}

export default defineModule({
  id: "tickets",
  name: "Tickets",
  summary: "A panel members use to open a private channel with the support team.",
  category: "support",
  requires: ["ManageChannels"],

  settings: settingsSchema,

  commands: [
    {
      name: "ticket",
      variedReply: true,
      description: "Manage support tickets.",
      build: () =>
        new SlashCommandBuilder()
          .setName("ticket")
          .setDescription("Manage support tickets.")
          .addSubcommand((sub) =>
            sub.setName("panel").setDescription("Post the ticket panel in the configured channel."),
          )
          .addSubcommand((sub) =>
            sub
              .setName("close")
              .setDescription("Close this ticket.")
              .addStringOption((option) =>
                option.setName("reason").setDescription("Why the ticket is being closed."),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName("add")
              .setDescription("Add a member to this ticket.")
              .addUserOption((option) =>
                option.setName("member").setDescription("The member to add.").setRequired(true),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName("remove")
              .setDescription("Remove a member from this ticket.")
              .addUserOption((option) =>
                option.setName("member").setDescription("The member to remove.").setRequired(true),
              ),
          ),
      async run(interaction, ctx) {
        const sub = interaction.options.getSubcommand();

        if (sub === "panel") {
          if (!isSupportStaff(interaction, ctx.settings)) {
            await interaction.reply({
              content: "You need a support role or Manage Channels to do that.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const channel = ctx.guild.channels.cache.get(ctx.settings.panel.channel);
          if (!channel?.isTextBased()) {
            await interaction.reply({
              content:
              "No panel channel is set, or the one configured has been deleted. " +
              "Set one in the dashboard first.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const posted = await ctx.send(channel, ctx.settings.panel.message, {}, { fallback: PANEL_MESSAGE, rows: [panelRow(ctx.settings)] });
          if (!posted) {
            await interaction.reply({
              content: "I couldn't post the panel there. Check that I can send messages and embed links in that channel.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await ctx.reply(
            interaction,
            ctx.settings.messages.panelPosted,
            { panelChannel: `<#${channel.id}>` },
            { fallback: PANEL_POSTED_MESSAGE },
          );
          return;
        }

        const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({ content: "This isn't an open ticket channel.", flags: MessageFlags.Ephemeral });
          return;
        }

        if (sub === "close") {
          if (!canManageThisTicket(interaction, ctx.settings, ticket)) {
            await interaction.reply({
              content: "You need to be the ticket opener, hold a support role, or have Manage Channels to close this.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const reason = interaction.options.getString("reason");
          await ctx.reply(
            interaction,
            ctx.settings.messages.closing,
            closingValues(interaction.user, ticket, reason),
            { fallback: CLOSING_MESSAGE, ephemeral: false },
          );
          await closeTicket(ctx, ticket, { id: interaction.user.id, tag: interaction.user.tag });
          return;
        }

        const isAdd = sub === "add";
        if (!canManageThisTicket(interaction, ctx.settings, ticket, !isAdd)) {
          await interaction.reply({
            content: isAdd
              ? "You need to be the ticket opener, hold a support role, or have Manage Channels to do that."
              : "You need a support role or Manage Channels to do that.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const target = interaction.options.getUser("member", true);
        const channel = ctx.guild.channels.cache.get(ticket.channelId);
        if (channel?.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "This ticket's channel is missing.", flags: MessageFlags.Ephemeral });
          return;
        }

        if (isAdd) {
          await channel.permissionOverwrites.edit(target.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
          await ctx.reply(
            interaction,
            ctx.settings.messages.added,
            { member: `<@${target.id}>`, staff: `<@${interaction.user.id}>`, number: ticket.id },
            { fallback: ADDED_MESSAGE, ephemeral: false },
          );
        } else {
          await channel.permissionOverwrites.delete(target.id).catch(() => undefined);
          await ctx.reply(
            interaction,
            ctx.settings.messages.removed,
            { member: `<@${target.id}>`, staff: `<@${interaction.user.id}>`, number: ticket.id },
            { fallback: REMOVED_MESSAGE, ephemeral: false },
          );
        }
      },
    },
  ],

  components: {
    async open(interaction, { ctx }) {
      const decision = await openRequestDecision(ctx, interaction.user.id);
      if (!decision.allowed) {
        await interaction.reply({ content: decision.reason, flags: MessageFlags.Ephemeral });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(customId("tickets", "subject"))
        .setTitle("Open a ticket")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("subject")
              .setLabel("What do you need help with?")
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(200)
              .setRequired(false),
          ),
        );
      await interaction.showModal(modal);
    },

    async close(interaction, { ctx }) {
      const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId ?? "" } });
      if (!ticket || ticket.status !== "open") {
        await interaction.reply({ content: "This ticket is already closed.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (!canManageThisTicket(interaction, ctx.settings, ticket)) {
        await interaction.reply({
          content: "You need to be the ticket opener, hold a support role, or have Manage Channels to close this.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await ctx.reply(
        interaction,
        ctx.settings.messages.closing,
        closingValues(interaction.user, ticket, null),
        { fallback: CLOSING_MESSAGE, ephemeral: false },
      );
      await closeTicket(ctx, ticket, { id: interaction.user.id, tag: interaction.user.tag });
    },
  },

  modals: {
    async subject(interaction, { ctx }) {
      const decision = await openRequestDecision(ctx, interaction.user.id);
      if (!decision.allowed) {
        await interaction.reply({ content: decision.reason, flags: MessageFlags.Ephemeral });
        return;
      }

      const category = ctx.guild.channels.cache.get(ctx.settings.category);
      if (category?.type !== ChannelType.GuildCategory) {
        await interaction.reply({
          content:
            "No ticket category is set, or the one configured has been deleted. " +
            "Ask a server admin to set one in the dashboard.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const subject = interaction.fields.getTextInputValue("subject").trim() || null;
      const everyoneId = ctx.guild.roles.everyone.id;
      const overwrites = [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...ctx.settings.supportRoles.map((roleId) => ({
          id: roleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ];
      if (ctx.guild.members.me) {
        overwrites.push({
          id: ctx.guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        });
      }

      let channel;
      try {
        channel = await ctx.guild.channels.create({
          name: ticketChannelName(interaction.user.username),
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: overwrites,
          topic: subject ? `Opened by ${interaction.user.tag}: ${subject}` : `Opened by ${interaction.user.tag}`,
        });
      } catch (error) {
        console.error("[tickets] failed to create ticket channel:", error);
        await interaction.editReply(
          "Something went wrong creating your ticket channel. Try again, or tell a server admin if it keeps happening.",
        );
        return;
      }

      const ticket = await prisma.ticket.create({
        data: {
          guildId: ctx.guild.id,
          channelId: channel.id,
          openerId: interaction.user.id,
          subject: subject ?? undefined,
        },
      });

      const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId("tickets", "close", String(ticket.id)))
          .setLabel("Close ticket")
          .setStyle(ButtonStyle.Danger),
      );
      await ctx.send(
        channel,
        ctx.settings.messages.opened,
        openedValues(interaction.user, ticket, channel.id, ctx.settings.supportRoles),
        { fallback: OPENED_MESSAGE, rows: [closeRow] },
      );

      if (ctx.settings.autoClose.enabled) {
        await ctx.tasks.schedule("autoclose", new Date(Date.now() + ctx.settings.autoClose.after), {
          channelId: channel.id,
        });
      }

      await ctx.reply(
        interaction,
        ctx.settings.messages.created,
        { ticket: `<#${channel.id}>`, number: ticket.id, subject: subject ?? "" },
        { fallback: CREATED_MESSAGE },
      );
    },
  },

  events: {
    // Any human message in an open ticket channel pushes the auto-close
    // deadline back, so a ticket only closes once nobody has spoken in it for
    // the configured window. The lookup runs on every message in the guild
    // when auto-close is on; a unique-indexed read against SQLite is cheap
    // enough that this is not worth gating further.
    async messageCreate(message, ctx) {
      if (!ctx.settings.autoClose.enabled || message.author.bot) return;
      const ticket = await prisma.ticket.findUnique({ where: { channelId: message.channelId } });
      if (!ticket || ticket.status !== "open") return;
      await ctx.tasks.cancel("autoclose", { channelId: ticket.channelId });
      await ctx.tasks.schedule("autoclose", new Date(Date.now() + ctx.settings.autoClose.after), {
        channelId: ticket.channelId,
      });
    },
  },

  tasks: {
    async autoclose(payload, ctx) {
      const channelId = payload["channelId"];
      if (typeof channelId !== "string") return;
      const ticket = await prisma.ticket.findUnique({ where: { channelId } });
      if (!ticket || ticket.status !== "open") return;
      await closeTicket(ctx, ticket, { id: "auto-close", tag: "Auto-close" });
    },
  },
});
