import {
  ActionRowBuilder,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import {
  canTakeAction,
  customId,
  presetNamed,
  type EvidenceMessage,
  type ComponentEvent,
  type ContextCommandDefinition,
  type ModActionKind,
  type ModuleContext,
} from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { ActionRefused } from "../action-rules.js";
import { parseDuration } from "../duration.js";
import { resolveEvidence } from "../evidence.js";
import { fetchMemberOrNull } from "../lookups.js";
import { performAction } from "../perform.js";
import { applyPreset, presetLength } from "../presets.js";
import { replyRefusal, say } from "../reply.js";
import { staffRoleOf } from "../staff.js";
import { fillLabel, type Wording } from "../texts.js";
import { replyWithHistory } from "./history.js";
import { HISTORY_REPLY } from "../messages.js";

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

const VERB_KEY: Record<MenuAction, "menuWarn" | "menuTimeout" | "menuKick" | "menuBan"> = {
  warn: "menuWarn",
  timeout: "menuTimeout",
  kick: "menuKick",
  ban: "menuBan",
};

const CONFIRMATION: Record<MenuAction, "contextWarned" | "contextTimedOut" | "contextKicked" | "contextBanned"> = {
  warn: "contextWarned",
  timeout: "contextTimedOut",
  kick: "contextKicked",
  ban: "contextBanned",
};

// What Discord shows an entry's description as in the command list; fixed when the commands are registered.
const VERB: Record<MenuAction, string> = {
  warn: "Warn",
  timeout: "Time out",
  kick: "Kick",
  ban: "Ban",
};

const DISCORD_PERMISSION: Record<MenuAction, bigint> = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
};

const REASON_ROOM = 400;
/** Discord's limits on a select menu in a form: 25 options, each label, value and description at most 100 characters. */
const PRESET_OPTIONS_MAX = 25;
const clipOption = (text: string): string => (text.length > 100 ? `${text.slice(0, 97)}...` : text);

/** The preset picked in the form, if the form had a picker and something was picked. */
function pickedPreset(interaction: ModalSubmitInteraction): string | null {
  try {
    return interaction.fields.getStringSelectValues("preset")[0] ?? null;
  } catch {
    // A form opened while the server had no presets has no picker to read.
    return null;
  }
}

const abilityOf = (action: MenuAction, abilities: Wording["abilities"]): string => abilities[action];

function menuEntry(
  name: string,
  description: string,
  kind: "user" | "message",
  permission: bigint,
  run: ContextCommandDefinition<ModerationSettings>["run"],
  response?: ContextCommandDefinition<ModerationSettings>["response"],
): ContextCommandDefinition<ModerationSettings> {
  return {
    name,
    ...(response ? { response } : {}),
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
  const labels = ctx.settings.labels;
  const role = await staffRoleOf(ctx.guild.id, interaction.user.id);
  if (!role) return say(ctx, interaction, "staff", "notStaff");
  if (!canTakeAction(role, action)) return say(ctx, interaction, "staff", "needsAdmin", { action: abilityOf(action, labels.abilities) });

  const target = targetOf(interaction);
  if (!target) return say(ctx, interaction, "staff", "menuNotAMember");
  if (target.user.id === interaction.user.id) return say(ctx, interaction, "staff", "menuSelf");
  if (target.user.id === ctx.client.user?.id) return say(ctx, interaction, "staff", "menuBot");

  const { menu } = labels;
  const rest = [action, target.user.id, ...(target.message ? [target.message.channelId, target.message.id] : [])].join(":");
  const modal = new ModalBuilder()
    .setCustomId(customId("moderation", "ctxact", rest))
    .setTitle(fillLabel(menu.modalTitle, { verb: menu[VERB_KEY[action]], name: target.user.username }).slice(0, 45));

  const presets = ctx.settings.reasonPresets.slice(0, PRESET_OPTIONS_MAX);
  if (presets.length > 0) {
    const picker = new StringSelectMenuBuilder()
      .setCustomId("preset")
      .setPlaceholder(menu.presetPlaceholder)
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(1)
      .addOptions(
        presets.map((preset) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(clipOption(preset.name)).setValue(clipOption(preset.name));
          return preset.reason.trim() === "" ? option : option.setDescription(clipOption(preset.reason));
        }),
      );
    modal.addLabelComponents(new LabelBuilder().setLabel(menu.presetLabel).setStringSelectMenuComponent(picker));
  }

  const reason = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel(menu.reasonLabel)
    .setStyle(TextInputStyle.Paragraph)
    // With presets on offer, picking one is enough, so the box can be left empty here and the
    // server's rule on reasons is applied to what the two make together.
    .setRequired(ctx.settings.requireReason && presets.length === 0)
    .setMaxLength(REASON_ROOM)
    .setPlaceholder(target.message ? menu.reasonPlaceholderMessage : menu.reasonPlaceholder);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));

  if (action === "timeout" || action === "ban") {
    const duration = new TextInputBuilder()
      .setCustomId("duration")
      .setLabel(action === "timeout" ? menu.timeoutLabel : menu.banLabel)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(12)
      .setPlaceholder(action === "timeout" ? menu.timeoutPlaceholder : menu.banPlaceholder);
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
    if (!(await staffRoleOf(ctx.guild.id, interaction.user.id))) return say(ctx, interaction, "staff", "notStaff");
    const target = targetOf(interaction);
    if (!target) return say(ctx, interaction, "staff", "menuNotAMember");

    await replyWithHistory(ctx, interaction, target.user.id, target.user.username);
  },
  HISTORY_REPLY,
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
  const labels = ctx.settings.labels;
  const [action, targetId, channelId, messageId] = rest.split(":");
  if (!action || !isMenuAction(action) || !targetId || !/^\d{17,20}$/.test(targetId)) {
    return say(ctx, interaction, "staff", "menuOutOfDate");
  }

  const role = await staffRoleOf(ctx.guild.id, interaction.user.id);
  if (!role) return say(ctx, interaction, "staff", "notStaff");
  if (!canTakeAction(role, action)) return say(ctx, interaction, "staff", "needsAdmin", { action: abilityOf(action, labels.abilities) });

  // A preset picked from the menu leads, with anything typed after it. Typing a preset's name works as picking it.
  const typedRaw = interaction.fields.getTextInputValue("reason").trim();
  const picked = presetNamed(pickedPreset(interaction), ctx.settings.reasonPresets);
  const typedChoice = picked ? null : applyPreset(typedRaw, ctx.settings.reasonPresets, action);
  const typed = picked ? [picked.reason, typedRaw].filter(Boolean).join("\n") : (typedChoice?.reason ?? typedRaw);
  const presetMs = picked ? presetLength(picked, action) : (typedChoice?.durationMs ?? null);
  const link =
    channelId && messageId && /^\d{17,20}$/.test(channelId) && /^\d{17,20}$/.test(messageId)
      ? `https://discord.com/channels/${ctx.guild.id}/${channelId}/${messageId}`
      : null;

  let durationMs: number | null = null;
  let unreadableDuration = false;
  if (action === "timeout" || action === "ban") {
    const input = interaction.fields.getTextInputValue("duration").trim();
    if (input === "") {
      durationMs = presetMs ?? (action === "timeout" ? ctx.settings.defaultTimeoutDuration : null);
    } else {
      durationMs = parseDuration(input);
      unreadableDuration = durationMs === null;
    }
  }

  try {
    const [actorMember, user] = await Promise.all([
      fetchMemberOrNull(ctx.guild, interaction.user.id),
      ctx.client.users.fetch(targetId).catch(() => null),
    ]);

    // The message is copied now, before the action, so it is kept even if the action deletes it. If it
    // cannot be read, the case still records a link to it, as it always has.
    let evidence: EvidenceMessage[] = [];
    if (channelId && messageId && link) {
      try {
        evidence = await resolveEvidence(ctx.guild, targetId, [{ channelId, messageId }], { member: actorMember, isOwner: false });
      } catch (error) {
        if (!(error instanceof ActionRefused)) throw error;
      }
    }
    const reason = [typed, link && evidence.length === 0 ? `Message: ${link}` : ""].filter(Boolean).join("\n") || null;

    const { record, noteKeys } = await performAction(ctx, {
      action,
      targetId,
      targetName: user?.username ?? labels.actions.memberFallbackStart,
      moderatorId: interaction.user.id,
      reason,
      durationMs,
      unreadableDuration,
      deleteDays: null,
      actorMember,
      actorIsInstanceOwner: false,
      origin: "command",
      evidence,
    });

    const at = record.expiresAt ? Math.floor(record.expiresAt.getTime() / 1000) : null;
    await say(ctx, interaction, "confirmations", CONFIRMATION[action], {
      name: user?.username ?? labels.actions.memberFallback,
      case: record.caseNumber,
      notes: noteKeys.map((key) => ` ${labels.notes[key]}`).join(""),
      until: at === null ? "" : `<t:${at}:f>`,
      expiry: at === null ? "" : ` ${fillLabel(labels.notes.banExpires, { when: `<t:${at}:R>` })}`,
    });
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    await replyRefusal(ctx, interaction, error);
  }
}
