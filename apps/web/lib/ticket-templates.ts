import {
  applyVariablesToMessage,
  discordTimestamp,
  type MessageEmbed,
  type MessageError,
  type VariableValues,
} from "@tier0/core";
import {
  TICKET_REPLY_EMBEDS_MAX,
  savedReplyValues,
  type TicketDetailDto,
  type TicketTemplateDto,
  type TicketTemplatesDto,
} from "@tier0/shared-tickets";

/**
 * What the reply box decides about the Message creator templates it offers:
 * which match a search, how they group by folder, and what a template becomes
 * once its variables are filled and the parts a reply cannot carry are left
 * out. Free of React so the tests can import it.
 */

type TicketFacts = Pick<TicketDetailDto, "id" | "number" | "typeName" | "channelId" | "channelName" | "opener">;

/**
 * The values a template's `{variables}` become in this ticket: the ones saved
 * replies fill (`{user}`, `{number}` and the rest), the server's facts the bot
 * sent along, and the channel and time the way a send fills them.
 */
export function templateValues(ticket: TicketFacts, staffId: string, server: TicketTemplatesDto["variables"], now: Date): VariableValues {
  return {
    ...savedReplyValues(
      { id: ticket.id, number: ticket.number ?? null, typeName: ticket.typeName, openerId: ticket.opener.userId, channelId: ticket.channelId },
      staffId,
    ),
    ...server,
    channel: `<#${ticket.channelId}>`,
    "channel.name": ticket.channelName,
    date: discordTimestamp(now, "D"),
    time: discordTimestamp(now, "t"),
    now: discordTimestamp(now, "f"),
    sender: `<@${staffId}>`,
  };
}

const textOf = (template: TicketTemplateDto) =>
  [template.content, ...template.embeds.flatMap((embed) => [embed.title, embed.description, embed.authorName, embed.footerText, ...embed.fields.flatMap((field) => [field.name, field.value])])]
    .join(" ")
    .toLowerCase();

/** The templates matching a search: by name first, then folder, then anything they say. Empty search keeps the order given. */
export function matchTemplates(templates: readonly TicketTemplateDto[], query: string): TicketTemplateDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...templates];
  const byName = templates.filter((template) => template.name.toLowerCase().includes(needle));
  const byFolder = templates.filter((template) => !byName.includes(template) && (template.folder ?? "").toLowerCase().includes(needle));
  const byText = templates.filter((template) => !byName.includes(template) && !byFolder.includes(template) && textOf(template).includes(needle));
  return [...byName, ...byFolder, ...byText];
}

export interface TemplateGroup {
  /** Null for the templates that sit outside every folder. */
  folder: string | null;
  templates: TicketTemplateDto[];
}

/** Templates grouped by folder, the unfiled ones first and the folders in alphabetical order, each keeping the order it was given. */
export function groupTemplates(templates: readonly TicketTemplateDto[]): TemplateGroup[] {
  const unfiled = templates.filter((template) => template.folder === null);
  const names = [...new Set(templates.flatMap((template) => (template.folder === null ? [] : [template.folder])))].sort((a, b) => a.localeCompare(b));
  return [
    ...(unfiled.length > 0 ? [{ folder: null, templates: unfiled }] : []),
    ...names.map((folder) => ({ folder, templates: templates.filter((template) => template.folder === folder) })),
  ];
}

/** The sentence about the parts of a template a reply cannot carry, or null when it has none. */
export function leftOutNote(leftOut: TicketTemplateDto["leftOut"]): string | null {
  if (leftOut.length === 0) return null;
  const list = leftOut.length === 1 ? leftOut[0]! : `${leftOut.slice(0, -1).join(", ")} and ${leftOut[leftOut.length - 1]}`;
  return `Its ${list} are left out, because a reply cannot carry them.`;
}

/** The template as it will be added: variables filled in. The preview in the dialog shows this. */
export function filledTemplate(template: TicketTemplateDto, values: Readonly<VariableValues>): { content: string; embeds: MessageEmbed[] } {
  const filled = applyVariablesToMessage({ content: template.content, embeds: template.embeds, buttons: [], selects: [], reactions: [] }, { ...values });
  return { content: filled.content, embeds: filled.embeds };
}

export interface TemplateInsert {
  /** Text to put in the reply box at the cursor, or "" when the template's text was not asked for or it has none. */
  text: string;
  /** Embeds to add after the ones already in the reply. */
  embeds: MessageEmbed[];
  /** Short sentences about what was left out and why. */
  notes: string[];
}

/**
 * What choosing a template adds to the draft. The embeds go through the same
 * count, character allowance and validation as one built by hand, so what is
 * added can always be sent; one that does not fit is left out with a note
 * rather than blocking the rest. Text is only taken when asked for.
 */
/** What is wrong with an embed once the others are in the reply, as `embedProblems` in ticket-embeds answers. Passed in so this file loads on its own in the tests. */
export type EmbedCheck = (embed: MessageEmbed, others: readonly MessageEmbed[]) => MessageError[];

export function insertTemplate(
  template: TicketTemplateDto,
  values: Readonly<VariableValues>,
  current: readonly MessageEmbed[],
  withText: boolean,
  embedProblems: EmbedCheck,
): { ok: true; value: TemplateInsert } | { ok: false; error: string } {
  const filled = filledTemplate(template, values);
  const notes: string[] = [];
  const left = leftOutNote(template.leftOut);
  if (left) notes.push(left);

  const added: MessageEmbed[] = [];
  for (const [index, embed] of filled.embeds.entries()) {
    const label = filled.embeds.length === 1 ? "Its embed" : `Embed ${index + 1}`;
    if (current.length + added.length >= TICKET_REPLY_EMBEDS_MAX) {
      notes.push(`${label} was left out: a reply can carry ${TICKET_REPLY_EMBEDS_MAX} embeds.`);
      continue;
    }
    const problems = embedProblems(embed, [...current, ...added]);
    if (problems.length > 0) {
      notes.push(`${label} was left out: ${problems[0]!.message}`);
      continue;
    }
    added.push({ ...embed, name: "" });
  }

  const text = withText ? filled.content.trim() : "";
  if (text === "" && added.length === 0) {
    return { ok: false, error: notes.length > 0 ? notes.join(" ") : "There is nothing in this template to add. Tick Also use its text to add its text." };
  }
  return { ok: true, value: { text, embeds: added, notes } };
}
