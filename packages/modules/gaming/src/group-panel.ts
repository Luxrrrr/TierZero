import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from "discord.js";
import { customId, type ComponentHandler, type ModalHandler, type RowHooks } from "@tier0/core";
import type { GamingCtx } from "./context.js";
import { modal } from "./group-controls.js";
import { GAME_MAX, cleanGame } from "./group-logic.js";
import { optionOf, startGroup } from "./groups.js";
import { postReport, postStatus, publishMessage, type Published } from "./panel-post.js";
import { GROUP_PANEL } from "./messages.js";
import type { GamingSettings, GroupPanelSetting } from "./settings.js";

/**
 * The message in a hub channel with one button per option. Pressing a button
 * starts a group, see groups.ts. A panel is posted from the dashboard and
 * edited in place when posted again.
 */

const STYLES: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** Discord allows five buttons in a row and five rows in a message. */
const PER_ROW = 5;

export function panelRows(panel: GroupPanelSetting): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  panel.options.forEach((option, index) => {
    if (index % PER_ROW === 0) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>());
    const button = new ButtonBuilder()
      .setCustomId(customId("gaming", "groupStart", `${panel.id}:${option.id}`))
      .setLabel(option.label)
      .setStyle(STYLES[option.style] ?? ButtonStyle.Secondary);
    if (option.emoji) button.setEmoji(option.emoji);
    rows[rows.length - 1]?.addComponents(button);
  });
  return rows;
}

export const groupPanelComponents: Record<string, ComponentHandler<GamingSettings>> = {
  /** Asks what they are playing first when the option does, and otherwise starts the group at once. */
  async groupStart(interaction, { rest, ctx }) {
    const [panelId = "", optionId = ""] = rest.split(":");
    const found = ctx.settings.groups.enabled ? optionOf(ctx.settings, panelId, optionId) : null;
    if (!found?.option.askGame) return startGroup(ctx, interaction, rest);
    const { labels } = ctx.settings.groups;
    await interaction.showModal(
      modal("groupStartGame", rest, labels.groupGameTitle, labels.groupGameLabel, {
        value: cleanGame(found.option.game ?? ""),
        max: GAME_MAX,
        required: false,
      }),
    );
  },
};

export const groupPanelModals: Record<string, ModalHandler<GamingSettings>> = {
  async groupStartGame(interaction, { rest, ctx }) {
    await startGroup(ctx, interaction, rest, cleanGame(interaction.fields.getTextInputValue("value")));
  },
};

/** Posts a panel, or edits its posted message when that still sits in the panel's channel. */
export async function publishPanel(ctx: GamingCtx, panel: GroupPanelSetting): Promise<Published> {
  if (panel.options.length === 0) return { ok: false, message: "Add at least one option before posting the panel." };
  return publishMessage(ctx, {
    panelId: panel.id,
    channelId: panel.channel,
    body: panel.message,
    fallback: GROUP_PANEL,
    values: { panel: panel.name },
    rows: panelRows(panel),
  });
}

export const groupPanelRows: RowHooks<GamingSettings> = {
  status: ({ ctx, rows }) => Promise.all(rows.map((ref) => postStatus(ctx, (ref.row as unknown as GroupPanelSetting).id))),
  actions: {
    post: {
      label: "Post in Discord",
      help: "Posts the panel in its channel, or updates the posted one in place.",
      async run({ ctx, row }) {
        return postReport(ctx, await publishPanel(ctx, row.row as unknown as GroupPanelSetting));
      },
    },
  },
};
