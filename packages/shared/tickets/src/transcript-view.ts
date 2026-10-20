/**
 * A ticket's conversation as Discord draws it, built once as a plain element
 * tree. The dashboard turns the tree into React elements and the downloaded
 * transcript turns it into an HTML string; neither decides anything about
 * layout, so the two cannot drift apart. Class names are styled by
 * `TRANSCRIPT_CSS` in `transcript-style.ts`.
 *
 * Text in the tree is raw: each renderer escapes it. Addresses are checked
 * here and again by each renderer, and only http and https survive.
 */

import { isEmojiOnly, markdownPlainText, parseDiscordMarkdown, type MarkdownContext, type MarkdownNode } from "./transcript-markdown.js";
import {
  ticketStaffLine,
  webUrl,
  type TicketAttachmentDto,
  type TicketComponentRowDto,
  type TicketEmbedDto,
  type TicketEmojiDto,
  type TicketMentionName,
  type TicketMessageDto,
} from "./tickets.js";

export type TranscriptAttrValue = string | number | boolean | null | undefined;

export interface TranscriptElement {
  tag: string;
  attrs: Record<string, TranscriptAttrValue>;
  /** Inline style, kebab-case properties. Only colours and grid placement are ever set. */
  style?: Record<string, string>;
  children: TranscriptNode[];
}

export type TranscriptNode = string | TranscriptElement;

/** Elements that never have children or a closing tag. */
export const TRANSCRIPT_VOID_TAGS: ReadonlySet<string> = new Set(["br", "img", "input", "hr"]);

/** Attributes whose value is an address, which every renderer checks again. */
export const TRANSCRIPT_URL_ATTRS: ReadonlySet<string> = new Set(["href", "src"]);

function h(tag: string, attrs: Record<string, TranscriptAttrValue> = {}, children: (TranscriptNode | null | false | undefined)[] = [], style?: Record<string, string>): TranscriptElement {
  const element: TranscriptElement = { tag, attrs, children: children.filter((child): child is TranscriptNode => child !== null && child !== false && child !== undefined && child !== "") };
  if (style && Object.keys(style).length > 0) element.style = style;
  return element;
}

// -- time -----------------------------------------------------------------

export interface TranscriptClock {
  /** What "Today" and relative timestamps are measured against. Null writes every date in full. */
  now: Date | null;
  /** An IANA zone; the reader's own when left out. */
  timeZone?: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function format(date: Date, zone: string | undefined, key: string, options: Intl.DateTimeFormatOptions): string {
  const id = `${zone ?? ""}|${key}`;
  let formatter = formatters.get(id);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(key === "day" ? "en-CA" : key === "p" ? "en-GB" : "en-US", { ...options, timeZone: zone });
    formatters.set(id, formatter);
  }
  // Newer ICU puts a narrow no-break space before AM and PM; Discord shows a plain one.
  return formatter.format(date).replace(/[\u202f\u00a0]/g, " ");
}

const clockTime = (date: Date, zone?: string) => format(date, zone, "t", { hour: "numeric", minute: "2-digit" });
const clockSeconds = (date: Date, zone?: string) => format(date, zone, "T", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const shortDate = (date: Date, zone?: string) => format(date, zone, "d", { month: "2-digit", day: "2-digit", year: "numeric" });
// Day before month and the month as a word, so neither side of the Atlantic misreads 05/10.
const plainDate = (date: Date, zone?: string) => format(date, zone, "p", { day: "numeric", month: "short", year: "numeric" });
const longDate = (date: Date, zone?: string) => format(date, zone, "D", { month: "long", day: "numeric", year: "numeric" });
const weekdayDate = (date: Date, zone?: string) => format(date, zone, "F", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const dayKey = (date: Date, zone?: string) => format(date, zone, "day", { year: "numeric", month: "2-digit", day: "2-digit" });

/** Named after a time written in UTC, which a reader elsewhere would otherwise take for their own. */
const zoneMark = (zone?: string) => (zone === "UTC" ? " UTC" : "");

/** The full moment, as Discord's tooltip on a message time reads. */
export function transcriptFullTime(date: Date, zone?: string): string {
  return `${weekdayDate(date, zone)} at ${clockTime(date, zone)}${zoneMark(zone)}`;
}

/**
 * A message's time beside its author: "Today at", "Yesterday at", or the date
 * written out. A file, read later and elsewhere, always gets the date and says
 * which zone its times are in.
 */
export function transcriptMessageTime(date: Date, clock: TranscriptClock): string {
  const time = clockTime(date, clock.timeZone);
  if (clock.now) {
    const day = dayKey(date, clock.timeZone);
    if (day === dayKey(clock.now, clock.timeZone)) return `Today at ${time}`;
    if (day === dayKey(new Date(clock.now.getTime() - 86_400_000), clock.timeZone)) return `Yesterday at ${time}`;
    return `${plainDate(date, clock.timeZone)} ${time}`;
  }
  return `${plainDate(date, clock.timeZone)} ${time}${zoneMark(clock.timeZone)}`;
}

function relative(ms: number, now: Date): string {
  const diff = ms - now.getTime();
  const seconds = Math.abs(diff) / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;
  let amount: string;
  if (seconds < 45) amount = "a few seconds";
  else if (seconds < 90) amount = "a minute";
  else if (minutes < 45) amount = `${Math.round(minutes)} minutes`;
  else if (minutes < 90) amount = "an hour";
  else if (hours < 22) amount = `${Math.round(hours)} hours`;
  else if (hours < 36) amount = "a day";
  else if (days < 26) amount = `${Math.round(days)} days`;
  else if (days < 46) amount = "a month";
  else if (days < 320) amount = `${Math.round(days / 30.4)} months`;
  else if (days < 548) amount = "a year";
  else amount = `${Math.round(days / 365.25)} years`;
  return diff >= 0 ? `in ${amount}` : `${amount} ago`;
}

/** A `<t:unix:style>` timestamp as Discord shows it. */
export function transcriptTimestamp(unix: number, style: string, clock: TranscriptClock): string {
  const date = new Date(unix * 1000);
  const zone = clock.timeZone;
  switch (style) {
    case "t":
      return clockTime(date, zone);
    case "T":
      return clockSeconds(date, zone);
    case "d":
      return shortDate(date, zone);
    case "D":
      return longDate(date, zone);
    case "F":
      return `${weekdayDate(date, zone)} ${clockTime(date, zone)}`;
    case "R":
      return relative(date.getTime(), clock.now ?? new Date());
    default:
      return `${longDate(date, zone)} ${clockTime(date, zone)}`;
  }
}

// -- input ----------------------------------------------------------------

/** Something that happened to the ticket, already worded. Drawn between messages in a style of its own, never as a message. */
export interface TranscriptActivity {
  key: string;
  at: string;
  text: string;
  detail?: string | null;
  kind: string;
}

export interface TranscriptLabels {
  /** `{channel}` is the channel's name. */
  welcomeTitle: string;
  welcomeText: string;
  empty: string;
  deleted: string;
  edited: string;
  replyMissing: string;
  app: string;
  viaDashboard: string;
  /** The visible pill on a message sent from the dashboard. */
  viaDashboardTag: string;
  /** `{name}` is the team member who sent a reply under the team's name. */
  sentBy: string;
  spoiler: string;
  messages: string;
  selectPlaceholder: string;
  /** In place of the two welcome lines when the ticket is a thread. */
  threadWelcomeTitle?: string;
  threadWelcomeText?: string;
}

export const DEFAULT_TRANSCRIPT_LABELS: TranscriptLabels = {
  welcomeTitle: "Welcome to #{channel}!",
  welcomeText: "This is the start of the #{channel} channel.",
  empty: "No messages were saved for this ticket.",
  deleted: "Deleted in Discord. Only staff can still see it here.",
  edited: "(edited)",
  replyMissing: "Original message was deleted",
  app: "APP",
  viaDashboard: "Sent from the dashboard",
  viaDashboardTag: "via dashboard",
  sentBy: "sent by {name}",
  spoiler: "Spoiler, select to show",
  messages: "Messages in #{channel}",
  selectPlaceholder: "Make a selection",
  threadWelcomeTitle: "{channel}",
  threadWelcomeText: "This is the start of the {channel} thread.",
};

export interface TranscriptTreeInput {
  messages: readonly TicketMessageDto[];
  /** Without the #. */
  channelName: string;
  topic?: string | null;
  activity?: readonly TranscriptActivity[];
  clock: TranscriptClock;
  labels?: Partial<TranscriptLabels>;
  /** Names known besides the ones stored with each message, such as the opener's. */
  names?: MarkdownContext;
  /**
   * Name who really sent a reply that went out under the team's name. The
   * dashboard turns it on; a transcript shows what Discord showed instead.
   */
  showSender?: boolean;
  /** The ticket is a private thread, which Discord heads with a thread icon instead of a #. */
  thread?: boolean;
}

/** The line beside the channel's name, the way the bot words a ticket channel's topic. */
export function transcriptTopic(opener: string | null, subject: string | null, typeName: string | null): string | null {
  const name = opener?.trim() || null;
  const about = subject?.trim() || null;
  if (name && about) return `Opened by ${name}: ${about}`;
  if (about) return about;
  if (name) return typeName ? `${typeName} ticket opened by ${name}` : `Opened by ${name}`;
  return typeName || null;
}

// -- pieces ---------------------------------------------------------------

/** Discord's own picture for someone without one, chosen from their id as the client does. */
export function defaultAvatarUrl(userId: string): string {
  let index = 0;
  if (/^\d{1,20}$/.test(userId)) {
    try {
      index = Number((BigInt(userId) >> 22n) % 6n);
    } catch {
      index = 0;
    }
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function customEmojiUrl(id: string, animated: boolean): string {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48&quality=lossless`;
}

const HEX = /^#[0-9a-f]{6}$/i;

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const hexOf = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

const fill = (template: string, channel: string) => template.split("{channel}").join(channel);

function icon(name: "hash" | "thread" | "external" | "file" | "caret", className: string): TranscriptElement {
  const paths: Record<typeof name, string> = {
    hash: "M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 8.5h16.5M3.5 15.5h16.5",
    thread: "M5 4v9a3 3 0 0 0 3 3h11M15 12l4 4-4 4",
    external: "M14 4h6v6M20 4l-8.5 8.5M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5",
    file: "M7 2.75h7.25L19.25 7.75v13.5H7zM14 2.75v5.25h5.25",
    caret: "M6.5 9.5 12 15l5.5-5.5",
  };
  return h("svg", { class: className, viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true", focusable: "false" }, [
    h("path", { d: paths[name], fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  ]);
}

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow ugc" };

function link(url: string | null, attrs: Record<string, TranscriptAttrValue>, children: (TranscriptNode | null | false | undefined)[], tagIfNone = "span"): TranscriptElement {
  const href = webUrl(url);
  return href ? h("a", { ...attrs, href, ...EXTERNAL }, children) : h(tagIfNone, attrs, children);
}

function emojiNode(emoji: TicketEmojiDto, className = "dt-emoji"): TranscriptElement {
  if (emoji.id) {
    return h("img", { class: className, src: customEmojiUrl(emoji.id, emoji.animated), alt: `:${emoji.name || "emoji"}:`, title: `:${emoji.name || "emoji"}:`, loading: "lazy", referrerpolicy: "no-referrer" });
  }
  return h("span", { class: "dt-emoji-u" }, [emoji.name]);
}

interface Ctx {
  clock: TranscriptClock;
  labels: TranscriptLabels;
  showSender?: boolean;
}

function markdown(nodes: readonly MarkdownNode[], ctx: Ctx, inLink = false): TranscriptNode[] {
  return nodes.map((node) => markdownNode(node, ctx, inLink));
}

function markdownNode(node: MarkdownNode, ctx: Ctx, inLink: boolean): TranscriptNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "br":
      return h("br");
    case "strong":
      return h("strong", {}, markdown(node.children, ctx, inLink));
    case "em":
      return h("em", {}, markdown(node.children, ctx, inLink));
    case "underline":
      return h("u", {}, markdown(node.children, ctx, inLink));
    case "strike":
      return h("s", {}, markdown(node.children, ctx, inLink));
    case "spoiler":
      // A checkbox reveals it, so it works with scripts off, as in the downloaded file.
      return inLink
        ? h("span", { class: "dt-spoiler-text" }, markdown(node.children, ctx, inLink))
        : h("label", { class: "dt-spoiler" }, [
            h("input", { class: "dt-spoiler-input", type: "checkbox", "aria-label": ctx.labels.spoiler }),
            h("span", { class: "dt-spoiler-text" }, markdown(node.children, ctx, inLink)),
          ]);
    case "code":
      return h("code", { class: "dt-code" }, [node.value]);
    case "codeblock":
      return h("pre", { class: "dt-codeblock" }, [
        node.lang ? h("span", { class: "dt-codeblock-lang" }, [node.lang]) : null,
        h("code", {}, [node.value]),
      ]);
    case "quote":
      return h("blockquote", { class: "dt-quote" }, markdown(node.children, ctx, inLink));
    case "heading":
      return h("div", { class: `dt-h dt-h${node.level}`, role: "heading", "aria-level": node.level + 3 }, markdown(node.children, ctx, inLink));
    case "subtext":
      return h("small", { class: "dt-subtext" }, markdown(node.children, ctx, inLink));
    case "list":
      return h(
        node.ordered ? "ol" : "ul",
        { class: "dt-list", start: node.ordered && node.start !== 1 ? node.start : undefined },
        node.items.map((item) => h("li", {}, markdown(item, ctx, inLink))),
      );
    case "link":
      return inLink ? h("span", {}, markdown(node.children, ctx, true)) : link(node.url, { class: "dt-link" }, markdown(node.children, ctx, true));
    case "mention": {
      const prefix = node.kind === "channel" ? "#" : node.kind === "command" ? "/" : "@";
      const color = node.color && HEX.test(node.color) ? node.color : null;
      return h(
        "span",
        { class: `dt-mention dt-mention-${node.kind}` },
        [`${prefix}${node.name}`],
        color && node.kind === "role" ? { color, "background-color": rgba(color, 0.1) } : undefined,
      );
    }
    case "emoji":
      return emojiNode({ id: node.id, name: node.name, animated: node.animated });
    case "unicodeEmoji":
      return h("span", { class: "dt-emoji-u" }, [node.value]);
    case "timestamp": {
      const date = new Date(node.unix * 1000);
      return h("time", { class: "dt-timestamp", datetime: date.toISOString(), title: transcriptFullTime(date, ctx.clock.timeZone) }, [
        transcriptTimestamp(node.unix, node.style, ctx.clock),
      ]);
    }
  }
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;

function isImageAttachment(file: TicketAttachmentDto): boolean {
  const type = (file.contentType ?? "").toLowerCase();
  if (type !== "") return type.startsWith("image/");
  try {
    return IMAGE_FILE.test(new URL(file.url).pathname);
  } catch {
    return false;
  }
}

function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function spoilerWrap(content: TranscriptElement, ctx: Ctx): TranscriptElement {
  return h("label", { class: "dt-spoiler dt-spoiler-media" }, [
    h("input", { class: "dt-spoiler-input", type: "checkbox", "aria-label": ctx.labels.spoiler }),
    h("span", { class: "dt-spoiler-text" }, [content]),
  ]);
}

function attachmentNode(file: TicketAttachmentDto, deleted: boolean, ctx: Ctx): TranscriptElement {
  const url = webUrl(file.url);
  const spoiler = file.name.startsWith("SPOILER_");
  let node: TranscriptElement;
  if (url && isImageAttachment(file) && !deleted) {
    node = h("a", { class: "dt-media", href: url, ...EXTERNAL }, [
      h("img", { class: "dt-media-image", src: url, alt: file.name, loading: "lazy", referrerpolicy: "no-referrer" }),
    ]);
  } else {
    node = h("div", { class: "dt-file" }, [
      icon("file", "dt-file-icon"),
      h("div", { class: "dt-file-meta" }, [
        link(url, { class: "dt-file-name" }, [file.name]),
        fileSize(file.size) ? h("div", { class: "dt-file-size" }, [fileSize(file.size)]) : null,
      ]),
    ]);
  }
  return spoiler ? spoilerWrap(node, ctx) : node;
}

function embedNode(embed: TicketEmbedDto, context: MarkdownContext, ctx: Ctx): TranscriptElement {
  // A link to a picture or a gif shows only the picture, without a box around it.
  const media = embed.imageUrl ?? embed.thumbnailUrl;
  const bareMedia = (embed.type === "image" || embed.type === "gifv") && embed.title === "" && embed.description === "" && embed.fields.length === 0;
  if (bareMedia && media) {
    return h("a", { class: "dt-media", href: media, ...EXTERNAL }, [h("img", { class: "dt-media-image", src: media, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })]);
  }

  // A video preview has its still as the large picture rather than in the corner.
  const video = embed.type === "video" && embed.imageUrl === null;
  const largeImage = video ? embed.thumbnailUrl : embed.imageUrl;
  const thumbnail = video ? null : embed.thumbnailUrl;
  const inline = (text: string) => markdown(parseDiscordMarkdown(text, context, { inline: true }), ctx);
  const block = (text: string) => markdown(parseDiscordMarkdown(text, context), ctx);

  // Inline fields share a row three at a time, two when a thumbnail takes the corner.
  const perRow = thumbnail ? 2 : 3;
  const fields: TranscriptElement[] = [];
  let k = 0;
  while (k < embed.fields.length) {
    const run: TicketEmbedDto["fields"] = [];
    while (k < embed.fields.length && embed.fields[k]!.inline && run.length < perRow) run.push(embed.fields[k++]!);
    if (run.length === 0) run.push(embed.fields[k++]!);
    const span = 12 / (run.length === 1 && !run[0]!.inline ? 1 : run.length);
    run.forEach((field, index) => {
      const start = 1 + index * span;
      fields.push(
        h("div", { class: "dt-embed-field" }, [h("div", { class: "dt-embed-field-name" }, inline(field.name)), h("div", { class: "dt-embed-field-value" }, block(field.value))], {
          "grid-column": `${start} / ${start + span}`,
        }),
      );
    });
  }

  const footerTime = embed.timestamp ? transcriptMessageTime(new Date(embed.timestamp), ctx.clock) : null;
  return h(
    "article",
    { class: `dt-embed${thumbnail ? " dt-embed-has-thumbnail" : ""}` },
    [
      h("div", { class: "dt-embed-grid" }, [
        embed.provider ? h("div", { class: "dt-embed-provider" }, [link(embed.provider.url, { class: "dt-embed-provider-name" }, [embed.provider.name])]) : null,
        embed.author
          ? h("div", { class: "dt-embed-author" }, [
              webUrl(embed.author.iconUrl)
                ? h("img", { class: "dt-embed-author-icon", src: webUrl(embed.author.iconUrl), alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
                : null,
              link(embed.author.url, { class: "dt-embed-author-name" }, [embed.author.name]),
            ])
          : null,
        embed.title ? h("div", { class: "dt-embed-title" }, [link(embed.url, { class: "dt-embed-title-link" }, inline(embed.title))]) : null,
        embed.description ? h("div", { class: "dt-embed-description" }, block(embed.description)) : null,
        fields.length > 0 ? h("div", { class: "dt-embed-fields" }, fields) : null,
        largeImage
          ? h("a", { class: "dt-embed-image", href: largeImage, ...EXTERNAL }, [h("img", { src: largeImage, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })])
          : null,
        thumbnail
          ? h("a", { class: "dt-embed-thumbnail", href: thumbnail, ...EXTERNAL }, [h("img", { src: thumbnail, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })])
          : null,
        embed.footer || footerTime
          ? h("div", { class: "dt-embed-footer" }, [
              embed.footer && webUrl(embed.footer.iconUrl)
                ? h("img", { class: "dt-embed-footer-icon", src: webUrl(embed.footer.iconUrl), alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
                : null,
              h("span", { class: "dt-embed-footer-text" }, [
                embed.footer ? embed.footer.text : null,
                embed.footer && footerTime ? h("span", { class: "dt-embed-footer-separator" }, ["•"]) : null,
                footerTime,
              ]),
            ])
          : null,
      ]),
    ],
    embed.color !== null ? { "border-left-color": hexOf(embed.color) } : undefined,
  );
}

const BUTTON_STYLE: Record<number, string> = { 1: "primary", 2: "secondary", 3: "success", 4: "danger", 5: "link", 6: "premium" };

function componentsNode(rows: readonly TicketComponentRowDto[], ctx: Ctx): TranscriptElement {
  return h(
    "div",
    { class: "dt-components" },
    rows.map((row) =>
      h(
        "div",
        { class: "dt-component-row" },
        row.components.map((item) => {
          if (item.kind === "select") {
            return h("div", { class: `dt-select${item.disabled ? " dt-disabled" : ""}` }, [
              h("span", { class: "dt-select-placeholder" }, [item.placeholder || ctx.labels.selectPlaceholder]),
              icon("caret", "dt-select-caret"),
            ]);
          }
          const style = BUTTON_STYLE[item.style] ?? "secondary";
          return h("span", { class: `dt-button dt-button-${style}${item.disabled ? " dt-disabled" : ""}` }, [
            item.emoji ? emojiNode(item.emoji, "dt-emoji dt-button-emoji") : null,
            item.label ? h("span", { class: "dt-button-label" }, [item.label]) : null,
            style === "link" ? icon("external", "dt-button-external") : null,
          ]);
        }),
      ),
    ),
  );
}

interface Prepared {
  message: TicketMessageDto;
  context: MarkdownContext;
  nodes: MarkdownNode[];
}

function layered(base: Record<string, TicketMentionName>, own: Readonly<Record<string, TicketMentionName>> | undefined): Record<string, TicketMentionName> {
  if (!own || Object.keys(own).length === 0) return base;
  return Object.assign(Object.create(base) as Record<string, TicketMentionName>, own);
}

const GROUP_GAP_MS = 7 * 60_000;
/**
 * Who a run of messages belongs to. A reply sent from the dashboard is a
 * webhook's post in Discord and a message the same person typed there is
 * theirs, so the two never share a header even though the author id is one.
 */
const authorKey = (message: TicketMessageDto) =>
  `${message.author.userId}:${message.author.name}:${message.source}:${message.author.bot === true ? "app" : "user"}`;

function messageNode(prepared: Prepared, start: boolean, byId: ReadonlyMap<string, Prepared>, ctx: Ctx): TranscriptElement {
  const { message, context, nodes } = prepared;
  const deleted = message.deletedAt !== null;
  const created = new Date(message.createdAt);
  const author = message.author;
  const nameColor = author.color && HEX.test(author.color) ? author.color : null;
  const avatar = webUrl(author.avatarUrl) ?? defaultAvatarUrl(author.userId);
  const reply = message.replyTo ? byId.get(message.replyTo) : undefined;

  const content: TranscriptNode[] = markdown(nodes, ctx);
  const hasText = content.length > 0;
  if (hasText && message.editedAt && !deleted) {
    content.push(h("span", { class: "dt-edited", title: transcriptFullTime(new Date(message.editedAt), ctx.clock.timeZone) }, [ctx.labels.edited]));
  }

  const head = start
    ? [
        h("img", { class: "dt-avatar", src: avatar, alt: "", width: 40, height: 40, loading: "lazy", referrerpolicy: "no-referrer" }),
        h("h3", { class: "dt-message-head" }, [
          h("span", { class: "dt-name" }, [author.name], nameColor ? { color: nameColor } : undefined),
          author.bot ? h("span", { class: "dt-tag" }, [ctx.labels.app]) : null,
          message.source === "dashboard"
            ? h("span", { class: "dt-via", title: ctx.showSender && message.sentBy ? `${ctx.labels.viaDashboard}: ${message.sentBy.name}` : ctx.labels.viaDashboard }, [ctx.labels.viaDashboardTag])
            : null,
          ctx.showSender && message.sentBy ? h("span", { class: "dt-sender" }, [ctx.labels.sentBy.split("{name}").join(message.sentBy.name)]) : null,
          h("time", { class: "dt-time", datetime: message.createdAt, title: transcriptFullTime(created, ctx.clock.timeZone) }, [transcriptMessageTime(created, ctx.clock)]),
        ]),
      ]
    : [h("time", { class: "dt-gutter-time", datetime: message.createdAt, title: transcriptFullTime(created, ctx.clock.timeZone) }, [clockTime(created, ctx.clock.timeZone)])];

  const replyNode = message.replyTo
    ? reply
      ? h("div", { class: "dt-reply" }, [
          h("img", { class: "dt-reply-avatar", src: webUrl(reply.message.author.avatarUrl) ?? defaultAvatarUrl(reply.message.author.userId), alt: "", loading: "lazy", referrerpolicy: "no-referrer" }),
          h(
            "span",
            { class: "dt-reply-name" },
            [`@${reply.message.author.name}`],
            reply.message.author.color && HEX.test(reply.message.author.color) ? { color: reply.message.author.color } : undefined,
          ),
          h("span", { class: "dt-reply-text" }, [replyPreview(reply)]),
        ])
      : h("div", { class: "dt-reply dt-reply-missing" }, [h("span", { class: "dt-reply-text" }, [ctx.labels.replyMissing])])
    : null;

  const stickers = message.stickers ?? [];
  const reactions = message.reactions ?? [];
  const components = message.components ?? [];

  return h(
    "li",
    {
      class: `dt-message${start ? " dt-message-start" : ""}${deleted ? " dt-message-deleted" : ""}${reply || message.replyTo ? " dt-message-reply" : ""}`,
      id: `dt-${message.messageId}`,
    },
    [
      replyNode,
      ...head,
      hasText ? h("div", { class: `dt-content${isEmojiOnly(nodes) ? " dt-content-jumbo" : ""}` }, content) : null,
      ...message.attachments.map((file) => attachmentNode(file, deleted, ctx)),
      ...message.embeds.map((embed) => embedNode(embed, context, ctx)),
      ...stickers.map((sticker) => {
        const ext = sticker.format === 4 ? "gif" : "png";
        return sticker.id && sticker.format !== 3
          ? h("div", { class: "dt-sticker" }, [
              h("img", { src: `https://media.discordapp.net/stickers/${sticker.id}.${ext}?size=160`, alt: sticker.name, title: sticker.name, loading: "lazy", referrerpolicy: "no-referrer" }),
            ])
          : h("div", { class: "dt-sticker dt-sticker-placeholder" }, [sticker.name]);
      }),
      components.length > 0 ? componentsNode(components, ctx) : null,
      reactions.length > 0
        ? h(
            "div",
            { class: "dt-reactions" },
            reactions.map((reaction) => h("span", { class: "dt-reaction" }, [emojiNode(reaction.emoji), h("span", { class: "dt-reaction-count" }, [String(reaction.count)])])),
          )
        : null,
      deleted ? h("p", { class: "dt-deleted-note" }, [ctx.labels.deleted]) : null,
    ],
  );
}

function replyPreview(prepared: Prepared): string {
  const text = markdownPlainText(prepared.nodes).replace(/\s+/g, " ").trim();
  if (text !== "") return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const { message } = prepared;
  if (message.attachments.length > 0) return "Click to see attachment";
  if (message.embeds.length > 0) return message.embeds[0]!.title || message.embeds[0]!.description.slice(0, 120) || "Click to see attachment";
  return "Click to see attachment";
}

/**
 * The whole conversation as an element tree: the channel's header, Discord's
 * welcome to the channel, and every message grouped the way the client groups
 * them.
 */
export function transcriptTree(input: TranscriptTreeInput): TranscriptElement {
  const labels = { ...DEFAULT_TRANSCRIPT_LABELS, ...input.labels };
  const ctx: Ctx = { clock: input.clock, labels, showSender: input.showSender === true };
  const channel = input.channelName || "ticket";

  // Everyone who wrote, and every name a message stored, so a mention in an
  // older message still reads as a name.
  const users: Record<string, TicketMentionName> = { ...input.names?.users };
  const roles: Record<string, TicketMentionName> = { ...input.names?.roles };
  const channels: Record<string, TicketMentionName> = { ...input.names?.channels };
  for (const message of input.messages) {
    if (!users[message.author.userId]) users[message.author.userId] = { name: message.author.name, color: message.author.color ?? null };
    if (message.mentions) {
      for (const [id, entry] of Object.entries(message.mentions.users)) users[id] ??= entry;
      for (const [id, entry] of Object.entries(message.mentions.roles)) roles[id] ??= entry;
      for (const [id, entry] of Object.entries(message.mentions.channels)) channels[id] ??= entry;
    }
  }

  const prepared: Prepared[] = input.messages.map((message) => {
    const context: MarkdownContext = {
      users: layered(users, message.mentions?.users),
      roles: layered(roles, message.mentions?.roles),
      channels: layered(channels, message.mentions?.channels),
    };
    // Discord showed the line naming the sender; the dashboard's own view names them in the header instead.
    const shown =
      message.staffLine && message.sentBy && !ctx.showSender
        ? [message.content, message.staffLineText ?? ticketStaffLine(message.sentBy.name, "Replied by {name}")].filter((part) => part !== "").join("\n")
        : message.content;
    return { message, context, nodes: shown ? parseDiscordMarkdown(shown, context) : [] };
  });
  const byId = new Map(prepared.map((entry) => [entry.message.messageId, entry]));

  type Entry = { at: number; order: number } & ({ kind: "message"; prepared: Prepared } | { kind: "activity"; activity: TranscriptActivity });
  const entries: Entry[] = [
    ...prepared.map((entry, order): Entry => ({ kind: "message", prepared: entry, at: Date.parse(entry.message.createdAt), order })),
    ...(input.activity ?? []).map((activity, order): Entry => ({ kind: "activity", activity, at: Date.parse(activity.at), order: order + prepared.length })),
  ];
  entries.sort((a, b) => a.at - b.at || a.order - b.order);

  const items: TranscriptElement[] = [];
  let day: string | null = null;
  let last: { key: string; at: number } | null = null;
  for (const entry of entries) {
    const date = new Date(entry.at);
    const thisDay = dayKey(date, input.clock.timeZone);
    if (thisDay !== day) {
      const label = longDate(date, input.clock.timeZone);
      items.push(h("li", { class: "dt-divider", role: "separator", "aria-label": label }, [h("span", { class: "dt-divider-text" }, [label])]));
      day = thisDay;
      last = null;
    }
    if (entry.kind === "activity") {
      const { activity } = entry;
      items.push(
        h("li", { class: "dt-activity", "data-kind": activity.kind }, [
          h("span", { class: "dt-activity-text" }, [activity.text]),
          activity.detail ? h("span", { class: "dt-activity-detail" }, [activity.detail]) : null,
          h("time", { class: "dt-activity-time", datetime: activity.at, title: transcriptFullTime(date, input.clock.timeZone) }, [clockTime(date, input.clock.timeZone)]),
        ]),
      );
      last = null;
      continue;
    }
    const { message } = entry.prepared;
    const key = authorKey(message);
    const start = last === null || last.key !== key || entry.at - last.at >= GROUP_GAP_MS || Boolean(message.replyTo);
    items.push(messageNode(entry.prepared, start, byId, ctx));
    last = { key, at: entry.at };
  }

  const mark = input.thread ? "thread" : "hash";
  const welcomeTitle = input.thread ? (labels.threadWelcomeTitle ?? "{channel}") : labels.welcomeTitle;
  const welcomeText = input.thread ? (labels.threadWelcomeText ?? labels.welcomeText) : labels.welcomeText;
  return h("div", { class: "dt", ...(input.thread ? { "data-thread": "true" } : {}) }, [
    h("div", { class: "dt-header" }, [
      icon(mark, "dt-header-icon"),
      h("h2", { class: "dt-header-name" }, [channel]),
      input.topic ? h("div", { class: "dt-header-divider", "aria-hidden": "true" }) : null,
      input.topic ? h("div", { class: "dt-header-topic", title: input.topic }, [input.topic]) : null,
    ]),
    h("div", { class: "dt-chat" }, [
      h("div", { class: "dt-welcome" }, [
        h("div", { class: "dt-welcome-icon" }, [icon(mark, "dt-welcome-hash")]),
        h("h3", { class: "dt-welcome-title" }, [fill(welcomeTitle, channel)]),
        h("p", { class: "dt-welcome-text" }, [fill(welcomeText, channel)]),
      ]),
      items.length > 0 ? h("ol", { class: "dt-messages", "aria-label": fill(labels.messages, channel) }, items) : h("p", { class: "dt-empty" }, [labels.empty]),
    ]),
  ]);
}
