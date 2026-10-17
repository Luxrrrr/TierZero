import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { customId, type TicketEventKind } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import type { TicketPanel, TicketType } from "./panels.js";
import { openTargetRest, questionBounds, typeLabel, type PanelType } from "./resolve.js";
import type { TicketSettings } from "./settings.js";

/**
 * The buttons, menus and forms the module adds under messages, and the
 * timeline row each change to a ticket leaves. The wording on all of them is
 * in the settings' labels.
 */

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

const BUTTON_STYLE: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const id = (action: string, rest = "") => customId("tickets", action, rest);

/** A colour from the settings, or the one the button has always had when the setting is missing or unknown. */
const styleOf = (value: string | undefined, fallback: ButtonStyle) => (value ? (BUTTON_STYLE[value] ?? fallback) : fallback);

/** One button per type, five to a row, or one menu holding every type. */
export function panelRows(panel: TicketPanel): Row[] {
  if (panel.style === "menu") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(id("pick", panel.id))
      .addOptions(
        panel.types.map((type) => {
          const option: { label: string; value: string; description?: string; emoji?: string } = {
            label: typeLabel(type).slice(0, 100),
            value: type.id,
          };
          if (type.appearance.description) option.description = type.appearance.description.slice(0, 100);
          if (type.emoji) option.emoji = type.emoji;
          return option;
        }),
      );
    if (panel.placeholder.trim() !== "") menu.setPlaceholder(panel.placeholder.slice(0, 150));
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)];
  }
  const rows: Row[] = [];
  panel.types.forEach((type, index) => {
    if (index % 5 === 0) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>());
    const button = new ButtonBuilder()
      .setCustomId(id("open", openTargetRest(panel.id, type.id)))
      .setLabel(typeLabel(type).slice(0, 80))
      .setStyle(BUTTON_STYLE[type.appearance.buttonStyle] ?? ButtonStyle.Primary);
    if (type.emoji) button.setEmoji(type.emoji);
    rows.at(-1)?.addComponents(button);
  });
  return rows;
}

/** The questions a type asks before its ticket opens. */
export function formOf({ panel, type }: PanelType, title: string): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(id("subject", openTargetRest(panel.id, type.id))).setTitle(title.slice(0, 45));
  type.form.slice(0, 5).forEach((question, index) => {
    const { min, max } = questionBounds(question);
    const input = new TextInputBuilder()
      .setCustomId(`q${index}`)
      .setLabel(question.label)
      .setStyle(question.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setMaxLength(max)
      .setRequired(question.required);
    if (min !== undefined) input.setMinLength(min);
    if (question.placeholder) input.setPlaceholder(question.placeholder);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  });
  return modal;
}

/** Close, and Claim or Unclaim, under the first message of a ticket. */
export function ticketRows(settings: TicketSettings, ticket: Pick<Ticket, "id" | "claimedById">, type: TicketType | undefined): Row[] {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(id("close", String(ticket.id)))
      .setLabel(settings.labels.closeButton)
      .setStyle(styleOf(settings.labels.closeButtonStyle, ButtonStyle.Danger)),
  );
  if (type?.rules.claim !== false) {
    const claimed = ticket.claimedById !== null;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(id(claimed ? "unclaim" : "claim", String(ticket.id)))
        .setLabel(claimed ? settings.labels.unclaimButton : settings.labels.claimButton)
        .setStyle(
          claimed
            ? styleOf(settings.labels.unclaimButtonStyle, ButtonStyle.Secondary)
            : styleOf(settings.labels.claimButtonStyle, ButtonStyle.Success),
        ),
    );
  }
  return [row];
}

/** Close and Keep open, for the opener to answer a close request with. */
export function closeRequestRows(settings: TicketSettings, ticketId: number): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(id("confirmClose", String(ticketId)))
        .setLabel(settings.labels.requestCloseButton)
        .setStyle(styleOf(settings.labels.requestCloseButtonStyle, ButtonStyle.Danger)),
      new ButtonBuilder()
        .setCustomId(id("keepOpen", String(ticketId)))
        .setLabel(settings.labels.keepOpenButton)
        .setStyle(styleOf(settings.labels.keepOpenButtonStyle, ButtonStyle.Secondary)),
    ),
  ];
}

/** Reopen and Delete, under the notice in a closed ticket whose channel was kept. */
export function closedRows(settings: TicketSettings, ticketId: number, reopen: boolean): Row[] {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (reopen) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(id("reopen", String(ticketId)))
        .setLabel(settings.labels.reopenButton)
        .setStyle(styleOf(settings.labels.reopenButtonStyle, ButtonStyle.Success)),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(id("delete", String(ticketId)))
      .setLabel(settings.labels.deleteButton)
      .setStyle(styleOf(settings.labels.deleteButtonStyle, ButtonStyle.Danger)),
  );
  return [row];
}

/**
 * The 1 to 5 buttons under the rating request. It is a direct message, so the
 * id starts with the server for the router to find it.
 */
export function ratingRows(guildId: string, ticketId: number): Row[] {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  for (let rating = 1; rating <= 5; rating++) {
    row.addComponents(new ButtonBuilder().setCustomId(id("rate", `${guildId}:${ticketId}:${rating}`)).setLabel(String(rating)).setStyle(ButtonStyle.Secondary));
  }
  return [row];
}

export function ratingCommentForm(settings: TicketSettings, guildId: string, ticketId: number): ModalBuilder {
  const { commentTitle, commentQuestion, commentPlaceholder } = settings.ratings;
  const input = new TextInputBuilder()
    .setCustomId("comment")
    .setLabel(commentQuestion.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  if (commentPlaceholder) input.setPlaceholder(commentPlaceholder.slice(0, 100));
  return new ModalBuilder()
    .setCustomId(id("rateComment", `${guildId}:${ticketId}`))
    .setTitle(commentTitle.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

/** Asks why a ticket is closed, for a type that wants a reason. */
export function reasonForm(settings: TicketSettings, ticketId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(id("closeReason", String(ticketId)))
    .setTitle(settings.labels.reasonTitle.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel(settings.labels.reasonQuestion.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
}

/** One entry on a ticket's timeline. Never fails the change it records. */
export async function recordEvent(
  ticketId: number,
  kind: TicketEventKind,
  actor: { userId: string; name: string } | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await prisma.ticketEvent
    .create({ data: { ticketId, kind, actorId: actor?.userId ?? null, actorName: actor?.name ?? null, detail: JSON.stringify(detail) } })
    .catch((error: unknown) => console.error(`[tickets] could not record ${kind} on ticket ${ticketId}:`, error));
}
