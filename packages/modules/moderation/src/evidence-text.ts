import { MESSAGE_LIMITS, type EvidenceMessage } from "@tier0/core";
import { DEFAULT_WORDING, fillLabel, type Wording } from "./texts.js";

/**
 * The messages that led to an action, written out for the member's direct
 * message. What a member wrote is repeated back to them, so it is cut short and
 * made unable to ping or break the layout, and the whole block is held under
 * the size of one embed field so a long case never makes the message too big
 * to send.
 */

export const DM_EVIDENCE = {
  /** Most messages written out. Further ones are counted instead. */
  shown: 5,
  /** Most characters of one message's text. */
  content: 300,
  /** Most lines of one message's text. */
  lines: 6,
  /** Most attachment names listed for one message. */
  files: 5,
  fileName: 40,
  field: MESSAGE_LIMITS.fieldValue,
} as const;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

type EvidenceWords = Pick<
  Wording["notes"],
  "evidenceOne" | "evidenceMany" | "evidenceMoreOne" | "evidenceMoreMany" | "evidenceDeleted" | "evidenceAttachments" | "evidenceNoText"
>;

export interface FormattedEvidence {
  /** The field's name: Message for one, Messages for several. Empty when there is nothing to show. */
  title: string;
  /** Empty when there is nothing to show, which leaves an embed field that uses it out. */
  value: string;
}

/**
 * Takes the power to ping, link a channel or open a code block out of text a
 * member wrote. A direct message cannot ping anyone, but the text is also kept
 * safe for any place it is later reused.
 */
export function neutralise(text: string): string {
  return text
    .replace(/<([@#])/g, `<${ZERO_WIDTH_SPACE}$1`)
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH_SPACE}$1`)
    .replace(/```/g, `\`${ZERO_WIDTH_SPACE}\`\``);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

/** A name for a file or a channel, on one line and without the characters that would format what follows it. */
function plainName(name: string, max: number): string {
  return cut(neutralise(name).replace(/[\r\n]+/g, " ").replace(/[*_~|`>[\]()]/g, "").trim(), max);
}

function quote(content: string, max: number): string {
  const text = cut(neutralise(content.replace(/\r\n/g, "\n")).trim(), max);
  const lines = text.split("\n").slice(0, DM_EVIDENCE.lines);
  return lines.map((line) => `> ${line}`).join("\n");
}

function render(stored: EvidenceMessage, words: EvidenceWords, contentMax: number): string {
  // Stored copies are read back from JSON, so a damaged one must not stop the message going out.
  const message = {
    ...stored,
    channelName: typeof stored.channelName === "string" ? stored.channelName : "",
    content: typeof stored.content === "string" ? stored.content : "",
    url: typeof stored.url === "string" ? stored.url : "",
    attachments: Array.isArray(stored.attachments) ? stored.attachments.filter((file) => typeof file?.name === "string") : [],
  };
  const head: string[] = [];
  const channel = plainName(message.channelName, 60);
  if (channel) head.push(`**#${channel}**`);
  const sent = Date.parse(message.createdAt);
  if (Number.isFinite(sent)) head.push(`<t:${Math.floor(sent / 1000)}:f>`);
  // A deleted message has nothing left to open.
  if (message.deleted) head.push(words.evidenceDeleted);
  else if (/^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(message.url)) head.push(`[Jump to message](${message.url})`);

  const lines: string[] = [];
  if (head.length > 0) lines.push(head.join(" - "));
  const hasFiles = message.attachments.length > 0;
  if (message.content.trim() !== "" && contentMax > 0) lines.push(quote(message.content, contentMax));
  else if (!hasFiles && message.content.trim() === "") lines.push(`> ${words.evidenceNoText}`);
  if (hasFiles) {
    const names = message.attachments.slice(0, DM_EVIDENCE.files).map((file) => plainName(file.name, DM_EVIDENCE.fileName) || "file");
    lines.push(fillLabel(words.evidenceAttachments, { names: names.join(", ") }));
  }
  return lines.join("\n");
}

/**
 * The block for the direct message's {evidence}. Up to five messages, each cut
 * to 300 characters, as many as fit in one field; the rest are counted. A
 * message that is gone is shown from the copy kept with the case, with no link.
 */
export function formatEvidence(
  messages: readonly EvidenceMessage[],
  words: EvidenceWords = DEFAULT_WORDING.notes,
  limit: number = DM_EVIDENCE.field,
): FormattedEvidence {
  if (messages.length === 0) return { title: "", value: "" };

  const more = (n: number) => fillLabel(n === 1 ? words.evidenceMoreOne : words.evidenceMoreMany, { n });
  const blocks: string[] = [];
  let used = 0;
  const candidates = messages.slice(0, DM_EVIDENCE.shown);
  for (const [index, message] of candidates.entries()) {
    const gap = blocks.length > 0 ? 2 : 0;
    const left = messages.length - index - 1;
    // Room is kept for the line that counts what is left out, when anything is.
    const reserve = left > 0 ? more(left).length + 2 : 0;
    const room = limit - used - gap - reserve;
    let cap: number = DM_EVIDENCE.content;
    let block = render(message, words, cap);
    while (block.length > room && cap > 0) {
      cap = cap > 40 ? cap - 20 : 0;
      block = render(message, words, cap);
    }
    // Not even its heading fits, so this and every later message is counted.
    if (block.length > room) break;
    blocks.push(block);
    used += gap + block.length;
  }

  const hidden = messages.length - blocks.length;
  const parts = hidden > 0 ? [...blocks, more(hidden)] : blocks;
  const value = cut(parts.join("\n\n"), limit);
  return { title: messages.length === 1 ? words.evidenceOne : words.evidenceMany, value };
}

/** What the dashboard's preview and the setting's sample show. */
export const EVIDENCE_SAMPLE = "**#general** - <t:1792339920:f> - [Jump to message](https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890)\n> check out my new server, join now";
