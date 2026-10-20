import { MESSAGE_LIMITS, embedLength, parseMessage, type MessageEmbed, type MessageError } from "@tier0/core";
import { TICKET_REPLY_EMBEDS_MAX, readTicketReplyEmbeds } from "@tier0/shared-tickets";

/**
 * What the reply box decides about the embeds of a reply: how much of Discord's
 * character allowance they use, what to call each one, and what is wrong with
 * one before it is added. Free of React so the tests can import it.
 */

/** Characters the embeds of one reply may hold between them. */
export const EMBED_BUDGET = MESSAGE_LIMITS.embedTotal;

export const REPLY_EMBEDS_MAX = TICKET_REPLY_EMBEDS_MAX;

/** Characters Discord counts across these embeds. */
export function embedsUsed(embeds: readonly MessageEmbed[]): number {
  return embeds.reduce((sum, embed) => sum + embedLength(embed), 0);
}

/** What a chip says: the title, else the start of the description, else the author or the first field. */
export function embedLabel(embed: MessageEmbed, index: number): string {
  const text = [embed.title, embed.description, embed.authorName, embed.fields[0]?.name, embed.footerText]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .find((part) => part !== "");
  if (!text) return `Embed ${index + 1}`;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/**
 * The problems of one embed in a dialog, as the field paths the editor reads
 * (`embeds[0].title`), then anything only a reply refuses, such as a link that
 * is a variable, and last the allowance the others have left over.
 */
export function embedProblems(embed: MessageEmbed, others: readonly MessageEmbed[]): MessageError[] {
  const parsed = parseMessage({ content: "", embeds: [embed] });
  const errors = parsed.ok ? [] : [...parsed.errors];
  if (errors.length === 0) {
    const reply = readTicketReplyEmbeds({ embeds: [embed] });
    if (!reply.ok) errors.push({ path: "", message: reply.error.replace(/^Embed 1: /, "") });
  }
  const used = embedsUsed(others) + embedLength(embed);
  if (used > EMBED_BUDGET) {
    errors.push({
      path: "",
      message: `The embeds of this reply would hold ${used.toLocaleString()} characters. Discord allows ${EMBED_BUDGET.toLocaleString()} in one message, so shorten this one by ${(used - EMBED_BUDGET).toLocaleString()}.`,
    });
  }
  return errors;
}
