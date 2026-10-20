import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from "discord.js";
import { customId, type ModuleContext } from "@tier0/core";
import { type EvidenceMessage } from "@tier0/shared-moderation";
import type { ModerationSettings } from "./settings.js";
import { DM_MESSAGE } from "./messages.js";
import { formatEvidence } from "./evidence-text.js";
import { actionLabel, noticeValues, type ActionNotice } from "./modlog.js";
import { defaultBody, fillLabel } from "./texts.js";

/** What a direct message knows beyond the action itself. Each part is left empty when it does not apply. */
export interface DmContext {
  caseNumber?: number | undefined;
  /** When the action was taken. Defaults to now. */
  createdAt?: Date | undefined;
  /** The messages that led to the action, as kept with the case. */
  evidence?: readonly EvidenceMessage[] | undefined;
  /** The moderator's display name, shown only when the server turned that on. */
  moderatorDisplayName?: string | undefined;
  /** How many warnings count against the member, this one included. Only for a warning. */
  warnings?: number | undefined;
  /** The escalation rule that took the action, when one did. */
  rule?: string | undefined;
}

/** The notes that follow the first sentence start on a line of their own, so they read as separate from a reason that has no full stop. */
const BREAK = String.fromCharCode(10);

type DmSettings = Pick<ModerationSettings, "labels" | "dmIncludeMessages" | "dmShowModerator" | "appeals">;

/**
 * Everything the member's direct message can use. Every variable is present, empty when it does not apply, so a
 * field built from one is left out instead of showing the variable's name.
 */
export function dmValues(settings: DmSettings, notice: ActionNotice, context: DmContext = {}): Record<string, string | number> {
  const created = context.createdAt ?? new Date();
  const values = noticeValues({ ...notice, createdAt: created, ...(context.caseNumber !== undefined ? { caseNumber: context.caseNumber } : {}) }, settings.labels);
  const notes = settings.labels.notes;
  const evidence = settings.dmIncludeMessages === false ? { title: "", value: "" } : formatEvidence(context.evidence ?? [], notes);
  const first = context.evidence?.[0]?.channelName;
  const warnings = context.warnings;

  values.case = context.caseNumber ?? "";
  values.caseNote = context.caseNumber !== undefined ? `Case #${context.caseNumber}` : "";
  values.evidence = evidence.value;
  values.evidenceTitle = evidence.value === "" ? "" : evidence.title;
  values.channel = evidence.value !== "" && first ? `#${first.replace(/\s+/g, " ").slice(0, 100)}` : "";
  values.when = `<t:${Math.floor(created.getTime() / 1000)}:f>`;
  values.warnings = warnings === undefined ? "" : warnings;
  values.warningNote = warnings !== undefined && warnings >= 2 ? `${BREAK}${fillLabel(notes.warningNote, { n: warnings })}` : "";
  values.rule = context.rule ?? "";
  values.appealNote = notice.action === "ban" && settings.appeals.enabled ? `${BREAK}${notes.appealNote}` : "";
  values.liftedNote = notice.action === "unban" || notice.action === "timeout-clear" ? `${BREAK}${notes.liftedNote}` : "";
  values.moderatorName = settings.dmShowModerator && context.moderatorDisplayName ? context.moderatorDisplayName : "";
  values.moderator ??= "";
  values.moderatorId ??= "";
  return values;
}

/**
 * Best-effort direct message. A member with DMs closed, or who has left
 * every server shared with the bot, makes this fail routinely - that must
 * never abort the action it is reporting on. Failures are swallowed here so
 * no call site has to remember to do it itself.
 */
export async function tryDirectMessage(
  ctx: ModuleContext<ModerationSettings>,
  userId: string,
  notice: ActionNotice,
  context: DmContext = {},
): Promise<boolean> {
  try {
    const user = await ctx.client.users.fetch(userId);
    const rows = notice.action === "ban" && ctx.settings.appeals.enabled ? [appealRow(ctx.guild.id, ctx.settings.appeals.buttonLabel)] : undefined;
    const sent = await ctx.send(user, ctx.settings.dmMessage, dmValues(ctx.settings, notice, context), { fallback: DM_MESSAGE, ...(rows ? { rows } : {}) });
    return sent !== null;
  } catch {
    return false;
  }
}

/**
 * The appeal button under a ban's direct message. It names the server and not the case: the case is
 * written after the message goes out, and pressing it later looks up the ban that is in force then.
 */
export function appealRow(guildId: string, label: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId("moderation", "appeal", guildId)).setStyle(ButtonStyle.Secondary).setLabel(label.slice(0, 80)),
  );
}

/** Tells a member that the message they were just sent about an action was a mistake. Best effort like the rest. */
export async function tryCorrectionMessage(
  ctx: ModuleContext<ModerationSettings>,
  userId: string,
  action: string,
): Promise<boolean> {
  try {
    const user = await ctx.client.users.fetch(userId);
    const values = { action: actionLabel(action, ctx.settings.labels).toLowerCase() };
    const sent = await ctx.send(user, ctx.settings.replies.direct.correction, values, { fallback: defaultBody("direct", "correction") });
    return sent !== null;
  } catch {
    return false;
  }
}
