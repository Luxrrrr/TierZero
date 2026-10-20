import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { customId, type ComponentHandler, type ModalHandler, type RowHooks } from "@tier0/core";
import { answer, type GamingCtx } from "./context.js";
import { GAME_MAX } from "./group-logic.js";
import { NOTE_MAX, requestPlayers } from "./lfg-request.js";
import { LFG_PANEL, LFG_REFUSALS } from "./messages.js";
import { postReport, postStatus, publishMessage } from "./panel-post.js";
import type { GamingSettings, LfgPanelSetting } from "./settings.js";

/**
 * The looking-for-group panel: a message with one button that opens a short
 * form, in place of typing /lfg. What the form asks goes through the same checks
 * and makes the same post as the command, see lfg-request.ts.
 */

const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);

function formFor(ctx: GamingCtx): ModalBuilder {
  const { lfg } = ctx.settings;
  const { labels } = lfg;
  const game = new TextInputBuilder().setCustomId("game").setLabel(labels.lfgFormGame).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(GAME_MAX);
  // Only worth listing when the choice is limited to them.
  if (lfg.restrictGames && lfg.games.length > 0) game.setPlaceholder(lfg.games.map((entry) => entry.name).join(", ").slice(0, 100));
  return new ModalBuilder()
    .setCustomId(customId("gaming", "lfgPanelForm", "form"))
    .setTitle(labels.lfgFormTitle)
    .addComponents(
      row(game),
      row(new TextInputBuilder().setCustomId("players").setLabel(labels.lfgFormPlayers).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setPlaceholder("2")),
      row(new TextInputBuilder().setCustomId("note").setLabel(labels.lfgFormNote).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(NOTE_MAX)),
      row(new TextInputBuilder().setCustomId("when").setLabel(labels.lfgFormWhen).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setPlaceholder("20:00 or in 90m")),
    );
}

export const lfgPanelComponents: Record<string, ComponentHandler<GamingSettings>> = {
  async lfgPanelStart(interaction, { ctx }) {
    if (!ctx.settings.lfg.enabled) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return answer(ctx, interaction, ctx.settings.messages.lfgRefusals.disabled, LFG_REFUSALS.disabled);
    }
    await interaction.showModal(formFor(ctx));
  },
};

export const lfgPanelModals: Record<string, ModalHandler<GamingSettings>> = {
  async lfgPanelForm(interaction, { ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = (name: string) => interaction.fields.getTextInputValue(name).trim();
    await requestPlayers(ctx, interaction, {
      game: text("game"),
      needed: Number(text("players")),
      note: text("note") || null,
      when: text("when") || null,
    });
  },
};

export function lfgPanelRowsOf(ctx: GamingCtx): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(customId("gaming", "lfgPanelStart", "panel")).setLabel(ctx.settings.lfg.labels.lfgRequest).setStyle(ButtonStyle.Success),
    ),
  ];
}

/** Posts a panel, or edits its posted message in place. */
export const publishLfgPanel = (ctx: GamingCtx, panel: LfgPanelSetting) =>
  publishMessage(ctx, {
    panelId: panel.id,
    channelId: panel.channel,
    body: panel.message,
    fallback: LFG_PANEL,
    values: { panel: panel.name },
    rows: lfgPanelRowsOf(ctx),
  });

export const lfgPanelRows: RowHooks<GamingSettings> = {
  status: ({ ctx, rows }) => Promise.all(rows.map((ref) => postStatus(ctx, (ref.row as unknown as LfgPanelSetting).id))),
  actions: {
    post: {
      label: "Post in Discord",
      help: "Posts the panel in its channel, or updates the posted one in place.",
      async run({ ctx, row: ref }) {
        return postReport(ctx, await publishLfgPanel(ctx, ref.row as unknown as LfgPanelSetting));
      },
    },
  },
};
