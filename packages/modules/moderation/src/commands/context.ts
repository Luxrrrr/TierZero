import {
  ActionRowBuilder,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import {
  canTakeAction,
  customId,
  type ComponentEvent,
  type ContextCommandDefinition,
  type ModActionKind,
  type ModuleContext,
} from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { ActionRefused } from "../action-rules.js";
import { parseDuration } from "../duration.js";
import { fetchMemberOrNull } from "../lookups.js";
import { performAction } from "../perform.js";
import { staffRoleOf } from "../staff.js";
import { historyEmbed } from "./history.js";

/**
 * The right-click menu on a member or a message. Discord decides who is shown
 * an entry from the permission set here, and that is only a courtesy: whoever
 * picks one is checked against the moderation staff list, the same list and the
 * same action levels the dashboard uses, before a form opens and again when it
 * is submitted.
 */

type Ctx = ModuleContext<ModerationSettings>;
type MenuAction = Extract<ModActionKind, "warn" | "timeout" | "kick" | "ban">;

const MENU_ACTIONS: readonly MenuAction[] = ["warn", "timeout", "kick", "ban"];
const isMenuAction = (value: string): value is MenuAction => (MENU_ACTIONS as readonly string[]).includes(value);

const VERB: Record<MenuAction, string> = {
  warn: "Warn",
  timeout: "Time out",
  kick: "Kick",
  ban: "Ban",
};

const NEEDS: Record<MenuAction, string> = {
  warn: "warn members",
  timeout: "time members out",
  kick: "kick members",
  ban: "ban members",
};

const DISCORD_PERMISSION: Record<MenuAction, bigint> = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
};

export const NOT_STAFF =
  "Only moderators on this server's staff list can use this. Ask the server owner to add you on the Access tab of the dashboard.";
const needsAdmin = (action: MenuAction) => `You need to be an admin to ${NEEDS[action]}. A moderator can warn and time members out.`;
const NOT_A_MEMBER_MESSAGE = "That message was not sent by a server member, so there is nobody to act on.";
const REASON_ROOM = 400;

async function refuse(interaction: ContextMenuCommandInteraction | ModalSubmitInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function menuEntry(
  name: string,
  description: string,
  kind: "user" | "message",
  permission: bigint,
  run: ContextCommandDefinition<ModerationSettings>["run"],
): ContextCommandDefinition<ModerationSettings> {
  return {
    name,
    description,
    kind,
    build: () =>
      new ContextMenuCommandBuilder()
        .setName(name)
        .setType(kind === "user" ? ApplicationCommandType.User : ApplicationCommandType.Message)
        .setDefaultMemberPermissions(permission)
        .setContexts(InteractionContextType.Guild),
    run,
  };
}

/** Whoever the menu was opened on: the member itself, or the author of the message. */
function targetOf(interaction: ContextMenuCommandInteraction): { user: User; message: { channelId: string; id: string } | null } | null {
  if (interaction.isUserContextMenuCommand()) return { user: interaction.targetUser, message: null };
  if (interaction.isMessageContextMenuCommand()) {
    const message = interaction.targetMessage;
    // A webhook or an app posts as something that is not a member, and has no one to warn or ban.
    if (message.webhookId) return null;
    return { user: message.author, message: { channelId: message.channelId, id: message.id } };
  }
  return null;
}

async function openForm(interaction: ContextMenuCommandInteraction, ctx: Ctx, action: MenuAction): Promise<void> {
  const role = await staffRoleOf(ctx.guild.id, interaction.user.id);
  if (!role) return refuse(interaction, NOT_STAFF);
  if (!canTakeAction(role, action)) return refuse(interaction, needsAdmin(action));

  const target = targetOf(interaction);
  if (!target) return refuse(interaction, NOT_A_MEMBER_MESSAGE);
  if (target.user.id === interaction.user.id) return refuse(interaction, "You cannot take an action on yourself.");
  if (target.user.id === ctx.client.user?.id) return refuse(interaction, "That is this bot. There is nothing to do.");

  const rest = [action, target.user.id, ...(target.message ? [target.message.channelId, target.message.id] : [])].join(":");
  const modal = new ModalBuilder()
    .setCustomId(customId("moderation", "ctxact", rest))
    .setTitle(`${VERB[action]} ${target.user.username}`.slice(0, 45));

  const reason = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(ctx.settings.requireReason)
    .setMaxLength(REASON_ROOM)
    .setPlaceholder(target.message ? "Why. A link to the message is added for you." : "Why");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));

  if (action === "timeout" || action === "ban") {
    const duration = new TextInputBuilder()
      .setCustomId("duration")
      .setLabel(action === "timeout" ? "How long" : "How long (empty is permanent)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(12)
      .setPlaceholder(action === "timeout" ? "10m, 2h or 7d. Empty uses the server's default." : "1d or 7d. Empty is permanent.");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(duration));
  }

  await interaction.showModal(modal);
}

function actionEntry(
  name: string,
  kind: "user" | "message",
  action: MenuAction,
): ContextCommandDefinition<ModerationSettings> {
  const subject = kind === "user" ? "member" : "message's author";
  return menuEntry(name, `${VERB[action]} a ${subject} from the right-click menu.`, kind, DISCORD_PERMISSION[action], (interaction, ctx) =>
    openForm(interaction, ctx, action),
  );
}

const historyEntry = menuEntry(
  "Member history",
  "Show a member's moderation history from the right-click menu.",
  "user",
  PermissionFlagsBits.ModerateMembers,
  async (interaction, ctx) => {
    if (!(await staffRoleOf(ctx.guild.id, interaction.user.id))) return refuse(interaction, NOT_STAFF);
    const target = targetOf(interaction);
    if (!target) return refuse(interaction, NOT_A_MEMBER_MESSAGE);

    const embed = await historyEmbed(ctx.guild.id, target.user.id, target.user.username);
    if (!embed) return refuse(interaction, `${target.user.username} has no recorded history.`);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
);

export const contextCommands: ContextCommandDefinition<ModerationSettings>[] = [
  actionEntry("Warn member", "user", "warn"),
  actionEntry("Timeout member", "user", "timeout"),
  actionEntry("Kick member", "user", "kick"),
  actionEntry("Ban member", "user", "ban"),
  historyEntry,
  actionEntry("Warn author", "message", "warn"),
  actionEntry("Timeout author", "message", "timeout"),
  actionEntry("Kick author", "message", "kick"),
  actionEntry("Ban author", "message", "ban"),
];

/** The submitted form: checks the person again, then hands the action to the shared performer. */
export async function submitContextAction(
  interaction: ModalSubmitInteraction,
  { rest, ctx }: ComponentEvent<ModerationSettings>,
): Promise<void> {
  const [action, targetId, channelId, messageId] = rest.split(":");
  if (!action || !isMenuAction(action) || !targetId || !/^\d{17,20}$/.test(targetId)) {
    return refuse(interaction, "That form is out of date. Open the menu again.");
  }

  const role = await staffRoleOf(ctx.guild.id, interaction.user.id);
  if (!role) return refuse(interaction, NOT_STAFF);
  if (!canTakeAction(role, action)) return refuse(interaction, needsAdmin(action));

  const typed = interaction.fields.getTextInputValue("reason").trim();
  const link =
    channelId && messageId && /^\d{17,20}$/.test(channelId) && /^\d{17,20}$/.test(messageId)
      ? `https://discord.com/channels/${ctx.guild.id}/${channelId}/${messageId}`
      : null;
  const reason = [typed, link ? `Message: ${link}` : ""].filter(Boolean).join("\n") || null;

  let durationMs: number | null = null;
  let unreadableDuration: string | undefined;
  if (action === "timeout" || action === "ban") {
    const input = interaction.fields.getTextInputValue("duration").trim();
    if (input === "") {
      durationMs = action === "timeout" ? ctx.settings.defaultTimeoutDuration : null;
    } else {
      durationMs = parseDuration(input);
      if (durationMs === null) {
        unreadableDuration = action === "timeout" ? "Duration must look like 10m, 2h or 7d." : "Duration must look like 1d or 7d.";
      }
    }
  }

  try {
    const [actorMember, user] = await Promise.all([
      fetchMemberOrNull(ctx.guild, interaction.user.id),
      ctx.client.users.fetch(targetId).catch(() => null),
    ]);
    const { record, notes } = await performAction(ctx, {
      action,
      targetId,
      targetName: user?.username ?? "That member",
      moderatorId: interaction.user.id,
      reason,
      durationMs,
      unreadableDuration,
      deleteDays: null,
      actorMember,
      actorIsInstanceOwner: false,
      origin: "command",
    });

    const name = user?.username ?? "the member";
    const done = {
      warn: `Warned ${name}.`,
      timeout: `Timed out ${name}${record.expiresAt ? ` until <t:${Math.floor(record.expiresAt.getTime() / 1000)}:f>` : ""}.`,
      kick: `Kicked ${name}.`,
      ban: `Banned ${name}.${record.expiresAt ? ` It expires <t:${Math.floor(record.expiresAt.getTime() / 1000)}:R>.` : ""}`,
    }[action];
    await interaction.reply({
      content: [done, `Case #${record.caseNumber}.`, ...notes].join(" "),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    await refuse(interaction, error.message);
  }
}
