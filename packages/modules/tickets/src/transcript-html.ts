import {
  applyVariables,
  readTicketAttachments,
  readTicketEmbeds,
  readTicketMentions,
  ticketMessageFromRow,
  TRANSCRIPT_CSS,
  TRANSCRIPT_URL_ATTRS,
  TRANSCRIPT_VOID_TAGS,
  transcriptTopic,
  transcriptTree,
  type TicketAnswer,
  type TicketMessageRow,
  type TranscriptLabels,
  type TranscriptNode,
} from "@tier0/core";
import { DEFAULT_TRANSCRIPT_TEXTS, type TranscriptTexts } from "./transcript.js";

/**
 * Transcripts of a stored ticket, from the `TicketMessage` rows rather than
 * from Discord, so they can be exported after the channel is gone.
 *
 * The HTML file is the dashboard's transcript view written out: the same tree
 * from `transcriptTree` and the same stylesheet, so a download looks like the
 * page it was downloaded from. It stands alone: styles inline, no scripts
 * (spoilers open with a checkbox), nothing loaded but images from Discord's
 * CDN. Every piece of text is escaped and only http and https addresses are
 * written, so a message is only ever text.
 */

/** The ticket as the export needs it. Field names follow the `Ticket` row so a row can be passed with a few additions. */
export interface StoredTranscriptTicket {
  id: number;
  /** The number in the server, shown in the header. The id stands in when there is none. */
  number?: number | null;
  guildName: string;
  channelName: string;
  typeName: string;
  subject: string | null;
  status: string;
  priority: string;
  /** The priority in the server's own words. The stored value is shown without it. */
  priorityLabel?: string;
  openerId: string;
  openerName: string;
  claimedByName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  closedByName: string | null;
  closeReason: string | null;
  answers: readonly TicketAnswer[];
  rating: number | null;
}

/** A `TicketMessage` row, its JSON columns still as stored. The row id is optional so a test can leave it out. */
export type StoredTranscriptMessage = Omit<TicketMessageRow, "id"> & { id?: number };

/** Words the HTML adds around what was said. The header lines come from the server's own transcript wording. */
export interface TranscriptHtmlLabels {
  details: string;
  type: string;
  priority: string;
  status: string;
  open: string;
  closed: string;
  claimedBy: string;
  reason: string;
  rating: string;
  answers: string;
  exported: string;
}

export const DEFAULT_TRANSCRIPT_HTML_LABELS: TranscriptHtmlLabels = {
  details: "Ticket details",
  type: "Type",
  priority: "Priority",
  status: "Status",
  open: "Open",
  closed: "Closed",
  claimedBy: "Handled by",
  reason: "Reason",
  rating: "Rating",
  answers: "Answers",
  exported: "Exported {time}. Times are in UTC. Attachments are links to Discord and stop working if Discord removes the file.",
};

export interface TranscriptRenderOptions {
  texts?: TranscriptTexts;
  labels?: TranscriptHtmlLabels;
  /** Words inside the conversation, the same ones the dashboard uses. */
  viewLabels?: Partial<TranscriptLabels>;
  /** When the export was made, for the footer. Defaults to now. */
  now?: Date;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML content and for a quoted attribute alike. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** An address that may go in an `href` or `src`: http or https only, so no `javascript:` or `data:` link survives. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const TAG = /^[a-z][a-z0-9]*$/;
const ATTR = /^[a-z][a-z0-9-]*$/i;
const STYLE_PROP = /^[a-z-]+$/;
const STYLE_VALUE = /^[#a-z0-9 ,.()/%-]+$/i;

/**
 * The tree as HTML. Tag and attribute names come from our own code, but they
 * are checked anyway, and every value and piece of text is escaped. An
 * address that is not http or https drops the attribute.
 */
export function transcriptNodeHtml(node: TranscriptNode): string {
  if (typeof node === "string") return escapeHtml(node);
  if (!TAG.test(node.tag)) return "";
  let attrs = "";
  for (const [name, raw] of Object.entries(node.attrs)) {
    if (raw === null || raw === undefined || raw === false || !ATTR.test(name)) continue;
    if (TRANSCRIPT_URL_ATTRS.has(name)) {
      const url = safeUrl(String(raw));
      if (url) attrs += ` ${name}="${escapeHtml(url)}"`;
      continue;
    }
    attrs += raw === true ? ` ${name}` : ` ${name}="${escapeHtml(String(raw))}"`;
  }
  if (node.style) {
    const style = Object.entries(node.style)
      .filter(([prop, value]) => STYLE_PROP.test(prop) && STYLE_VALUE.test(value))
      .map(([prop, value]) => `${prop}:${value}`)
      .join(";");
    if (style) attrs += ` style="${escapeHtml(style)}"`;
  }
  if (TRANSCRIPT_VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  let inner = "";
  for (const child of node.children) inner += transcriptNodeHtml(child);
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

function timestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/**
 * The opener as the conversation names them. The ticket keeps their username;
 * their messages keep the name they showed in the server, which is what a
 * reader sees beside every message, so the header uses that when it can.
 */
function openerShown(ticket: StoredTranscriptTicket, messages: readonly StoredTranscriptMessage[]): string {
  return messages.find((message) => message.authorId === ticket.openerId)?.authorName || ticket.openerName || ticket.openerId;
}

/** The header lines from the server's transcript wording, as plain strings. */
function headerLines(ticket: StoredTranscriptTicket, texts: TranscriptTexts, opener: string) {
  const reason = texts.reason ?? DEFAULT_TRANSCRIPT_TEXTS.reason ?? "";
  return {
    title: applyVariables(texts.title, { number: String(ticket.number ?? ticket.id), server: ticket.guildName, channel: ticket.channelName }),
    opened: applyVariables(texts.opened, { opener, time: timestamp(ticket.openedAt) }),
    subject: applyVariables(texts.subject, { subject: ticket.subject ?? texts.noSubject }),
    closed: ticket.closedAt
      ? applyVariables(texts.closed, { closer: ticket.closedByName || ticket.closedBy || "", time: timestamp(ticket.closedAt) })
      : null,
    reason: ticket.closedAt && ticket.closeReason ? applyVariables(reason, { reason: ticket.closeReason }) : null,
  };
}

const MENTION = /<(@!?|@&|#)(\d{17,20})>/g;

/** Mentions written as the names they had when the message was stored, the way the transcript view shows them. */
export function plainMentions(content: string, stored: string | null | undefined): string {
  const names = readTicketMentions(stored);
  return content.replace(MENTION, (whole, kind: string, id: string) => {
    const table = kind === "@&" ? names.roles : kind === "#" ? names.channels : names.users;
    const found = table[id];
    return found ? `${kind === "#" ? "#" : "@"}${found.name}` : whole;
  });
}

/** Everything a download adds below the conversation, kept out of the conversation so the page above reads as Discord. */
const PAGE_CSS = `
html,body{margin:0;background:#313338}
.dt-after{padding-bottom:32px}
.dt .dt-details{margin:24px 16px 0 72px;max-width:520px;padding:8px 16px 16px 12px;border-left:4px solid #5865f2;border-radius:4px;background:#2b2d31;font-size:14px;line-height:18px;color:#dbdee1}
.dt-details h2{margin:8px 0 4px;font-size:16px;line-height:22px;font-weight:600;color:#f2f3f5}
.dt-details p{margin:2px 0}
.dt-details dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 0}
.dt-details dt{font-weight:600;color:#f2f3f5}
.dt-details dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.dt-details-answers dl{grid-template-columns:minmax(0,1fr)}
.dt .dt-export{margin:16px 16px 0 72px;font-size:12px;color:#949ba4}
@media (max-width:600px){.dt .dt-details,.dt .dt-export{margin-left:16px}.dt-details dl{grid-template-columns:minmax(0,1fr)}}
`.trim();

/** The policy the file carries itself, which still applies once it is saved and opened from disk. */
export const TRANSCRIPT_HTML_CSP =
  "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const rowsToMessages = (messages: readonly StoredTranscriptMessage[]) =>
  messages.map((message, index) => ticketMessageFromRow({ ...message, id: message.id ?? index + 1 }));

/** The whole ticket as one HTML document. Messages are expected oldest first. */
export function renderTranscriptHtml(
  ticket: StoredTranscriptTicket,
  messages: readonly StoredTranscriptMessage[],
  options: TranscriptRenderOptions = {},
): string {
  const texts = options.texts ?? DEFAULT_TRANSCRIPT_TEXTS;
  const labels = options.labels ?? DEFAULT_TRANSCRIPT_HTML_LABELS;
  const header = headerLines(ticket, texts, openerShown(ticket, messages));
  const now = options.now ?? new Date();

  const tree = transcriptTree({
    messages: rowsToMessages(messages),
    channelName: ticket.channelName || `ticket-${ticket.number ?? ticket.id}`,
    topic: transcriptTopic(ticket.openerName || null, ticket.subject, ticket.typeName),
    // A file is read later, so dates are written in full rather than as "Today".
    clock: { now: null, timeZone: "UTC" },
    labels: { empty: texts.empty, ...options.viewLabels },
    names: ticket.openerName ? { users: { [ticket.openerId]: { name: ticket.openerName } } } : undefined,
  });

  const fact = (label: string, value: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const facts = [
    fact(labels.status, ticket.status === "open" ? labels.open : labels.closed),
    ticket.typeName ? fact(labels.type, ticket.typeName) : "",
    fact(labels.priority, ticket.priorityLabel ?? ticket.priority),
    ticket.claimedByName ? fact(labels.claimedBy, ticket.claimedByName) : "",
    ticket.closeReason ? fact(labels.reason, ticket.closeReason) : "",
    ticket.rating !== null ? fact(labels.rating, `${ticket.rating} / 5`) : "",
  ].join("");
  const answers = ticket.answers.filter((answer) => answer.value !== "");
  const answersHtml =
    answers.length === 0
      ? ""
      : `<div class="dt-details-answers"><h2>${escapeHtml(labels.answers)}</h2><dl>` +
        answers.map((answer) => fact(answer.label, answer.value)).join("") +
        `</dl></div>`;

  const details =
    `<section class="dt-details" aria-label="${escapeHtml(labels.details)}"><h2>${escapeHtml(header.title)}</h2>` +
    `<p>${escapeHtml(header.opened)}</p><p>${escapeHtml(header.subject)}</p>` +
    (header.closed ? `<p>${escapeHtml(header.closed)}</p>` : "") +
    `<dl>${facts}</dl>${answersHtml}</section>` +
    `<p class="dt-export">${escapeHtml(applyVariables(labels.exported, { time: timestamp(now) }))}</p>`;

  const body = transcriptNodeHtml(tree) + `<div class="dt dt-after">${details}</div>`;

  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(TRANSCRIPT_HTML_CSP)}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="dark">` +
    `<title>${escapeHtml(header.title)}</title><style>${TRANSCRIPT_CSS}\n${PAGE_CSS}</style></head>` +
    `<body class="dt-page">${body}</body></html>\n`
  );
}

export interface TranscriptTextMarks {
  edited: string;
  deleted: string;
}

/**
 * The plain-text transcript of a stored ticket, in the layout and wording of
 * the file the bot posts at close. An open ticket has no closing line, and
 * embeds are written out as their text.
 */
export function renderStoredTranscriptText(
  ticket: StoredTranscriptTicket,
  messages: readonly StoredTranscriptMessage[],
  texts: TranscriptTexts = DEFAULT_TRANSCRIPT_TEXTS,
  marks: TranscriptTextMarks = { edited: "(edited)", deleted: "(deleted)" },
): string {
  const header = headerLines(ticket, texts, openerShown(ticket, messages));
  const lines = [header.title, header.opened, header.subject, ...(header.closed ? [header.closed] : []), ...(header.reason ? [header.reason] : []), ""];
  if (messages.length === 0) {
    lines.push(texts.empty);
    return lines.join("\n") + "\n";
  }
  for (const message of messages) {
    const flags = [message.editedAt || message.edits > 0 ? marks.edited : "", message.deletedAt ? marks.deleted : ""].filter(Boolean);
    const line = applyVariables(texts.line, {
      time: timestamp(message.createdAt),
      author: message.authorName,
      authorId: message.authorId,
    });
    lines.push(flags.length > 0 ? `${line} ${flags.join(" ")}` : line);
    const embeds = readTicketEmbeds(message.embeds);
    const attachments = readTicketAttachments(message.attachments);
    if (message.content) lines.push(plainMentions(message.content, message.mentions));
    else if (embeds.length === 0 && attachments.length === 0) lines.push(texts.unavailable);
    for (const embed of embeds) {
      for (const part of [embed.author?.name, embed.title, embed.description]) if (part) lines.push(`  | ${part}`);
      for (const field of embed.fields) lines.push(`  | ${field.name}: ${field.value}`);
      if (embed.footer) lines.push(`  | ${embed.footer.text}`);
    }
    for (const attachment of attachments) lines.push(applyVariables(texts.attachment, { url: attachment.url }));
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
