import { MessageFlags, type ContextMenuCommandInteraction, type Guild, type MessageComponentInteraction, type RepliableInteraction } from "discord.js";
import { applyVariables, linksOnly, type MessageBody, type ReplyValues } from "@tier0/core";
import {
  LABEL_DEFAULTS,
  SYSTEM_MESSAGES,
  systemMessage,
  type SystemLabels,
  type SystemMessageKey,
  type SystemSettings,
} from "@tier0/module-system";
import { commandVariables, stringValues } from "./command-variables.js";
import { renderMessage, type RenderedMessage } from "./send-message.js";

/** Anything the bot can answer with a message only the asker sees. */
export type Answerable = RepliableInteraction | MessageComponentInteraction | ContextMenuCommandInteraction;

/** Where the bot's own text comes from. Narrowed to what is needed so tests can stand in for the guild state. */
export interface SystemSource {
  systemSettings(guildId: string): Promise<SystemSettings | null>;
}

/** The owner's version of a message, or the wording the bot has always used when there is none to read. */
export async function systemBody(source: SystemSource, guildId: string | null, key: SystemMessageKey): Promise<MessageBody> {
  if (guildId === null) return SYSTEM_MESSAGES[key];
  try {
    const settings = await source.systemSettings(guildId);
    return settings ? systemMessage(settings, key) : SYSTEM_MESSAGES[key];
  } catch (error) {
    console.error("The bot's own messages could not be read, so the usual wording is used:", error);
    return SYSTEM_MESSAGES[key];
  }
}

/** The owner's short pieces of text, each falling back to its default. */
export async function systemLabels(source: SystemSource, guildId: string | null): Promise<SystemLabels> {
  if (guildId === null) return { ...LABEL_DEFAULTS };
  try {
    const settings = await source.systemSettings(guildId);
    return settings ? { ...LABEL_DEFAULTS, ...settings.labels } : { ...LABEL_DEFAULTS };
  } catch (error) {
    console.error("The bot's own labels could not be read, so the usual text is used:", error);
    return { ...LABEL_DEFAULTS };
  }
}

/** Discord keeps at most this many characters of an audit-log reason. */
const REASON_LIMIT = 512;

/** The reason written to the audit log when removing a case on the dashboard lifts its timeout. */
export function timeoutRemovalReason(template: string | undefined, caseNumber: number, actor: string): string {
  return applyVariables(template ?? LABEL_DEFAULTS.timeoutRemovalReason, { case: String(caseNumber), actor }).slice(0, REASON_LIMIT);
}

/** The reason written to the audit log when removing a ban case on the dashboard unbans the member. */
export function banRemovalReason(template: string | undefined, caseNumber: number, actor: string): string {
  return applyVariables(template ?? LABEL_DEFAULTS.banRemovalReason, { case: String(caseNumber), actor }).slice(0, REASON_LIMIT);
}

/**
 * Fills in one of the bot's own messages. The owner's version is tried first;
 * if it no longer fits Discord's limits once its variables are in, the default
 * is sent instead, so a refusal never goes missing because of how it was worded.
 */
export async function renderSystem(
  source: SystemSource,
  guild: Guild | null,
  key: SystemMessageKey,
  variables: Record<string, string>,
): Promise<RenderedMessage | null> {
  const body = await systemBody(source, guild?.id ?? null, key);
  const known = guild ?? undefined;
  return renderMessage(linksOnly(body), variables, known) ?? renderMessage(linksOnly(SYSTEM_MESSAGES[key]), variables, known);
}

/**
 * Answers an interaction with one of the bot's own messages, shown only to the
 * person who asked. An interaction that already has an answer, or is waiting for
 * one, is followed up rather than replied to, so a failure is private even when
 * the command had chosen to answer in public. Never throws.
 */
export async function replySystem(
  source: SystemSource,
  interaction: Answerable,
  guild: Guild | null,
  key: SystemMessageKey,
  values: ReplyValues = {},
): Promise<boolean> {
  try {
    const variables = {
      ...commandVariables({
        guild,
        user: interaction.user,
        channelId: interaction.channelId ?? "",
        channel: interaction.channel,
        client: interaction.client,
      }),
      ...stringValues(values),
    };
    const rendered = await renderSystem(source, guild, key, variables);
    if (!rendered) return false;

    const { content, embeds, components, allowedMentions } = rendered.payload;
    const reply = { ...(content !== undefined ? { content } : {}), embeds, components, allowedMentions };
    // Ephemeral means nothing in a direct message, which only the clicker can see anyway.
    const flags = interaction.inGuild() ? { flags: MessageFlags.Ephemeral as const } : {};
    if (interaction.replied || interaction.deferred) await interaction.followUp({ ...reply, ...flags });
    else await interaction.reply({ ...reply, ...flags });
    return true;
  } catch (error) {
    console.error("The bot could not send one of its own messages:", error);
    return false;
  }
}
