import { MessageFlags, SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import {
  TICKET_NOTE_MAX,
  TICKET_PRIORITIES,
  TICKET_REPLY_MAX,
  canTicket,
  fillSavedReply,
  isTicketPriority,
  savedReplyValues,
  ticketDashboardUrl,
  type CommandDefinition,
} from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { accessOf, actorOf, isAnyStaff, isStaffOf, may, refuse, targetOf, type TicketCtx } from "./context.js";
import { PRIORITY_LABELS, priorityLabel } from "./labels.js";
import { INFO_MESSAGE, NOTE_ADDED_MESSAGE, PANEL_POSTED_LEGACY_MESSAGE, PANEL_POSTED_MESSAGE, TRANSCRIPT_LINK_MESSAGE } from "./messages.js";
import { asReply, ticketValues } from "./notice.js";
import { postPanelMessage } from "./panel-post.js";
import { answer, askReason, closeFrom, mayClose, needsReason, reopenFrom, settle } from "./people.js";
import { RENAME_MAX, relativeTime, ticketNumber } from "./records.js";
import { allTypes, findType } from "./resolve.js";
import type { TicketSettings } from "./settings.js";
import { sendReply } from "./webhooks.js";
import { addNote, changeMember, claim, rename, requestClose, setPriority, transfer, unclaim } from "./working.js";

/** How many people the person who opened a ticket may add to it. Support staff have no limit. */
const OPENER_ADD_LIMIT = 5;

/**
 * `/ticket` and its subcommands. Each one checks who is asking by the rules in
 * core, then calls the same operation the dashboard does. A refusal is one of
 * the server's own messages, shown only to the person who asked.
 */

const SUGGESTIONS = 25;

function build(): SlashCommandBuilder {
  const builder = new SlashCommandBuilder().setName("ticket").setDescription("Manage support tickets.");
  builder
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("Post or update the ticket panels.")
        .addStringOption((option) => option.setName("panel").setDescription("The panel to post. Leave empty for every panel.").setAutocomplete(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Close this ticket.")
        .addStringOption((option) => option.setName("reason").setDescription("Why the ticket is being closed.").setMaxLength(500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("request-close")
        .setDescription("Ask the opener whether this ticket can be closed.")
        .addStringOption((option) => option.setName("reason").setDescription("Why it can be closed.").setMaxLength(500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a member to this ticket.")
        .addUserOption((option) => option.setName("member").setDescription("The member to add.").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a member from this ticket.")
        .addUserOption((option) => option.setName("member").setDescription("The member to remove.").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("claim").setDescription("Take this ticket on."))
    .addSubcommand((sub) => sub.setName("unclaim").setDescription("Stop handling this ticket."))
    .addSubcommand((sub) =>
      sub
        .setName("priority")
        .setDescription("Set this ticket's priority.")
        .addStringOption((option) =>
          option
            .setName("level")
            .setDescription("The new priority.")
            .setRequired(true)
            .addChoices(...TICKET_PRIORITIES.map((value) => ({ name: PRIORITY_LABELS[value], value }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("rename")
        .setDescription("Rename this ticket's channel.")
        .addStringOption((option) => option.setName("name").setDescription("The new name.").setRequired(true).setMaxLength(RENAME_MAX)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("transfer")
        .setDescription("Move this ticket to another type.")
        .addStringOption((option) => option.setName("type").setDescription("The type to move it to.").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) => sub.setName("reopen").setDescription("Reopen this closed ticket."))
    .addSubcommand((sub) =>
      sub
        .setName("note")
        .setDescription("Add a note only staff can read, in the dashboard.")
        .addStringOption((option) => option.setName("text").setDescription("The note.").setRequired(true).setMaxLength(TICKET_NOTE_MAX)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reply")
        .setDescription("Send one of the server's saved replies in this ticket.")
        .addStringOption((option) => option.setName("name").setDescription("The saved reply to send.").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sub) => sub.setName("transcript").setDescription("Get a link to this ticket's transcript in the dashboard."))
    .addSubcommand((sub) => sub.setName("info").setDescription("Show this ticket's details."));
  return builder;
}

/** A saved reply by its name, as autocomplete fills it in or as someone typed it. */
function savedReplyNamed(settings: TicketSettings, value: string) {
  const wanted = value.trim().toLowerCase();
  return settings.savedReplies.find((saved) => saved.name === value) ?? settings.savedReplies.find((saved) => saved.name.trim().toLowerCase() === wanted);
}

/** A panel by id, which autocomplete fills in, or by the name someone typed. */
function panelNamed(settings: TicketSettings, value: string) {
  const wanted = value.trim().toLowerCase();
  return settings.panels.find((panel) => panel.id === value) ?? settings.panels.find((panel) => panel.name.toLowerCase() === wanted);
}

function typeNamed(settings: TicketSettings, value: string) {
  const wanted = value.trim().toLowerCase();
  return findType(settings, null, value) ?? allTypes(settings).find(({ type }) => type.name.toLowerCase() === wanted);
}

async function postPanels(ctx: TicketCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAnyStaff(ctx.settings, interaction)) return refuse(ctx, interaction, "notStaff");
  const named = interaction.options.getString("panel");
  const panels = named ? [panelNamed(ctx.settings, named)].filter((panel) => panel !== undefined) : ctx.settings.panels;
  if (panels.length === 0) return refuse(ctx, interaction, "panelMissing");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channels: string[] = [];
  let legacyLeft = false;
  for (const panel of panels) {
    const outcome = await postPanelMessage(ctx, panel);
    if (!(await answer(ctx, interaction, outcome))) return;
    if (outcome.ok) {
      channels.push(`<#${outcome.value.channelId}>`);
      legacyLeft ||= outcome.value.legacyMessageLeft;
    }
  }
  const values = { panelChannel: [...new Set(channels)].join(", ") };
  if (legacyLeft) await ctx.reply(interaction, ctx.settings.messages.panelPostedLegacy, values, { fallback: PANEL_POSTED_LEGACY_MESSAGE });
  else await ctx.reply(interaction, ctx.settings.messages.panelPosted, values, { fallback: PANEL_POSTED_MESSAGE });
}

async function inTicket(ctx: TicketCtx, interaction: ChatInputCommandInteraction, sub: string, ticket: Ticket): Promise<void> {
  const settings = ctx.settings;
  const actor = actorOf(interaction.user, interaction.member);
  const announce = asReply(ctx, ticket, interaction);
  const staff = isStaffOf(settings, interaction, ticket);

  switch (sub) {
    case "close": {
      if (!(await mayClose(ctx, interaction, ticket))) return;
      const reason = interaction.options.getString("reason");
      if (needsReason(ctx, ticket, reason)) return askReason(ctx, interaction, ticket);
      return closeFrom(ctx, interaction, ticket, reason);
    }
    case "add": {
      const staffAdds = may(settings, interaction, "members", ticket);
      if (!staffAdds && interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "cannotAdd");
      const member = interaction.options.getUser("member", true);
      if (!staffAdds) {
        // Each add pings the person and opens the channel to them, so an opener can bring in a few people, not any number.
        if (member.bot) return refuse(ctx, interaction, "addLimit");
        const added = await prisma.ticketEvent.count({ where: { ticketId: ticket.id, kind: "member_added", actorId: interaction.user.id } });
        if (added >= OPENER_ADD_LIMIT) return refuse(ctx, interaction, "addLimit");
      }
      await answer(ctx, interaction, await changeMember(ctx, ticket, { userId: member.id, action: "add" }, actor, announce));
      return;
    }
    case "remove": {
      if (!may(settings, interaction, "members", ticket)) return refuse(ctx, interaction, "notStaff");
      const member = interaction.options.getUser("member", true);
      if (member.id === ticket.openerId) return refuse(ctx, interaction, "cannotRemoveOpener");
      await answer(ctx, interaction, await changeMember(ctx, ticket, { userId: member.id, action: "remove" }, actor, announce));
      return;
    }
    case "claim": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      const access = accessOf(settings, interaction);
      if (ticket.claimedById && ticket.claimedById !== interaction.user.id && !canTicket(access, "claim", targetOf(ticket))) {
        return refuse(ctx, interaction, "alreadyClaimed", { claimedBy: `<@${ticket.claimedById}>` });
      }
      await answer(ctx, interaction, await claim(ctx, ticket, actor, announce));
      return;
    }
    case "unclaim": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      if (ticket.claimedById === null) return refuse(ctx, interaction, "notClaimed");
      if (!may(settings, interaction, "unclaim", ticket)) return refuse(ctx, interaction, "notYourClaim", { claimedBy: `<@${ticket.claimedById}>` });
      await answer(ctx, interaction, await unclaim(ctx, ticket, actor, announce));
      return;
    }
    case "priority": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      const level = interaction.options.getString("level", true);
      if (!isTicketPriority(level)) return refuse(ctx, interaction, "notATicket");
      await answer(ctx, interaction, await setPriority(ctx, ticket, level, actor, announce));
      if (ticket.priority === level) await settle(interaction);
      return;
    }
    case "rename": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      // Discord can hold a rename back for minutes, so the answer is deferred and the notice goes to the channel.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (await answer(ctx, interaction, await rename(ctx, ticket, interaction.options.getString("name", true), actor))) {
        await interaction.deleteReply().catch(() => undefined);
      }
      return;
    }
    case "transfer": {
      if (!may(settings, interaction, "transfer", ticket)) return refuse(ctx, interaction, "notStaff");
      const target = typeNamed(settings, interaction.options.getString("type", true));
      if (!target) return refuse(ctx, interaction, "typeNotFound");
      await answer(ctx, interaction, await transfer(ctx, ticket, target.type.id, actor, announce));
      return;
    }
    case "reply": {
      if (!may(settings, interaction, "reply", ticket)) return refuse(ctx, interaction, staff ? "notYourClaim" : "notStaff", { claimedBy: ticket.claimedById ? `<@${ticket.claimedById}>` : "" });
      const saved = savedReplyNamed(settings, interaction.options.getString("name", true));
      if (!saved) return refuse(ctx, interaction, "noSavedReply");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const content = fillSavedReply(saved.content, savedReplyValues(ticket, interaction.user.id)).slice(0, TICKET_REPLY_MAX);
      const outcome = await sendReply(ctx, ticket, content, actor);
      if (await answer(ctx, interaction, outcome)) await interaction.deleteReply().catch(() => undefined);
      return;
    }
    case "request-close": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      const outcome = await requestClose(ctx, ticket, interaction.options.getString("reason"), actor);
      if (await answer(ctx, interaction, outcome)) await settle(interaction);
      return;
    }
  }
}

/** Subcommands that also work in a closed ticket whose channel was kept. */
async function aboutTicket(ctx: TicketCtx, interaction: ChatInputCommandInteraction, sub: string, ticket: Ticket): Promise<void> {
  const settings = ctx.settings;
  const actor = actorOf(interaction.user, interaction.member);
  const staff = isStaffOf(settings, interaction, ticket);
  switch (sub) {
    case "note": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      await addNote(ticket, interaction.options.getString("text", true), actor);
      await ctx.reply(interaction, settings.messages.noteAdded, ticketValues(ticket, actor), { fallback: NOTE_ADDED_MESSAGE });
      return;
    }
    case "transcript": {
      if (!staff) return refuse(ctx, interaction, "notStaff");
      const ticketUrl = ticketDashboardUrl(await ctx.dashboardUrl(), ctx.guild.id, ticket.id);
      if (ticketUrl === "") return refuse(ctx, interaction, "noDashboard");
      await ctx.reply(interaction, settings.messages.transcriptLink, { number: ticketNumber(ticket), ticketUrl }, { fallback: TRANSCRIPT_LINK_MESSAGE });
      return;
    }
    case "info": {
      if (!staff && interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "notStaff");
      await ctx.reply(
        interaction,
        settings.messages.info,
        {
          number: ticketNumber(ticket),
          type: ticket.typeName,
          priority: priorityLabel(settings.labels, ticket.priority),
          user: `<@${ticket.openerId}>`,
          subject: ticket.subject ?? "",
          opened: relativeTime(ticket.openedAt),
          claimedBy: ticket.claimedById ? `<@${ticket.claimedById}>` : "",
        },
        { fallback: INFO_MESSAGE },
      );
      return;
    }
  }
}

const ABOUT = new Set(["note", "transcript", "info"]);

export const ticketCommand: CommandDefinition<TicketSettings> = {
  name: "ticket",
  variedReply: true,
  description: "Manage support tickets.",
  build,
  async run(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "panel") return postPanels(ctx, interaction);

    const ticket = await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } });
    if (sub === "reopen") return reopenFrom(ctx, interaction, ticket);
    if (ticket && ticket.guildId === ctx.guild.id && ABOUT.has(sub)) return aboutTicket(ctx, interaction, sub, ticket);
    if (!ticket || ticket.guildId !== ctx.guild.id || ticket.status !== "open") return refuse(ctx, interaction, "notATicket");
    return inTicket(ctx, interaction, sub, ticket);
  },
  async autocomplete(interaction: AutocompleteInteraction, ctx) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value).trim().toLowerCase();
    const matches = (name: string) => typed === "" || name.toLowerCase().includes(typed);
    const choices =
      focused.name === "panel"
        ? ctx.settings.panels.filter((panel) => matches(panel.name)).map((panel) => ({ name: panel.name.slice(0, 100), value: panel.id }))
        : focused.name === "type"
          ? allTypes(ctx.settings)
              .filter(({ type }) => matches(type.name))
              .map(({ panel, type }) => ({
                name: (ctx.settings.panels.length > 1 ? `${type.name} (${panel.name})` : type.name).slice(0, 100),
                value: type.id,
              }))
          : focused.name === "name"
            ? ctx.settings.savedReplies
                .filter((saved) => matches(saved.name))
                .map((saved) => ({ name: saved.name.slice(0, 100), value: saved.name.slice(0, 100) }))
            : [];
    await interaction.respond(choices.slice(0, SUGGESTIONS));
  },
};
