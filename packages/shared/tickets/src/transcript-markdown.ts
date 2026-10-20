/**
 * Discord's message markdown, read into a tree. The dashboard and the
 * downloaded transcript both draw from this tree, so a message reads the same
 * in both. It follows what the Discord client renders rather than CommonMark:
 * no paragraphs, a line break is a line break, and headings, lists and quotes
 * only count at the start of a line.
 *
 * The input is member text, so the parser is written to finish quickly on
 * anything: one pass over the text, a cap on how deep formatting may nest, a
 * cap on length, and a closing delimiter that was not found once is never
 * searched for again.
 */

import type { TicketMentionName } from "./tickets.js";

export type MarkdownNode =
  | { type: "text"; value: string }
  | { type: "br" }
  | { type: "strong" | "em" | "underline" | "strike" | "spoiler"; children: MarkdownNode[] }
  | { type: "code"; value: string }
  | { type: "codeblock"; lang: string; value: string }
  | { type: "quote"; children: MarkdownNode[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MarkdownNode[] }
  | { type: "subtext"; children: MarkdownNode[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownNode[][] }
  | { type: "link"; url: string; children: MarkdownNode[] }
  | {
      type: "mention";
      kind: "user" | "role" | "channel" | "everyone" | "here" | "command";
      id: string | null;
      name: string;
      color: string | null;
    }
  | { type: "emoji"; id: string; name: string; animated: boolean }
  | { type: "unicodeEmoji"; value: string }
  | { type: "timestamp"; unix: number; style: string };

/** The names behind ids, so a mention reads as `@name` rather than a number. */
export interface MarkdownContext {
  users?: Readonly<Record<string, TicketMentionName>>;
  roles?: Readonly<Record<string, TicketMentionName>>;
  channels?: Readonly<Record<string, TicketMentionName>>;
}

export interface MarkdownOptions {
  /** Only inline formatting, as in an embed's title or a field's name. */
  inline?: boolean;
  /** Masked links `[text](url)`, which Discord allows in embeds and, since 2023, in messages. */
  maskedLinks?: boolean;
}

/** Longest text parsed; the rest is kept as plain text. Discord's own limit is 4000 for a message and 4096 for an embed. */
export const MARKDOWN_MAX_INPUT = 8_000;
/** How deep formatting may nest before the rest is read as plain text. */
export const MARKDOWN_MAX_DEPTH = 8;

const HEX = /^#[0-9a-f]{6}$/i;
const colorOf = (value: string | null | undefined): string | null => (value && HEX.test(value) ? value.toLowerCase() : null);

const USER_MENTION = /<@!?(\d{17,20})>/y;
const ROLE_MENTION = /<@&(\d{17,20})>/y;
const CHANNEL_MENTION = /<#(\d{17,20})>/y;
const CUSTOM_EMOJI = /<(a?):([A-Za-z0-9_]{1,32}):(\d{17,20})>/y;
const TIMESTAMP = /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/y;
const COMMAND_MENTION = /<\/([\p{L}\p{N}_ -]{1,96}):(\d{17,20})>/uy;
const ANGLE_LINK = /<(https?:\/\/[^\s<>]{1,2000})>/y;
const BARE_LINK = /https?:\/\/[^\s<]{1,2000}/y;
const MASKED_LINK = /\[([^[\]\n]{1,256})\]\(\s*<?(https?:\/\/[^\s()<>]{1,2000})>?\s*\)/y;
const ESCAPABLE = new Set([..."\\*_~`|>#[]()-.!<:@/+="]);
const LIST_ITEM = /^( *)([-*]|\d{1,9}\.) +(.*)$/;
const UNICODE_EMOJI = /\p{Regional_Indicator}\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;

/** A web address as Discord links it: trailing punctuation that ends a sentence is not part of it. */
function trimLink(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1]!;
    if (".,:;\"'!?".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = url.split("(").length - 1;
      const closes = url.split(")").length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function linkable(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Plain text, with unicode emoji split out so they can be drawn larger, as Discord does. */
function textNodes(value: string, out: MarkdownNode[]): void {
  if (value === "") return;
  let last = 0;
  for (const match of value.matchAll(UNICODE_EMOJI)) {
    const start = match.index ?? 0;
    if (start > last) pushText(out, value.slice(last, start));
    out.push({ type: "unicodeEmoji", value: match[0] });
    last = start + match[0].length;
  }
  if (last < value.length) pushText(out, value.slice(last));
}

function pushText(out: MarkdownNode[], value: string): void {
  const prev = out[out.length - 1];
  if (prev && prev.type === "text") prev.value += value;
  else out.push({ type: "text", value });
}

class Inline {
  /** Where a search for a closing delimiter last failed: none exists at or after that point. */
  private readonly misses = new Map<string, number>();

  constructor(
    private readonly src: string,
    private readonly ctx: MarkdownContext,
    private readonly maskedLinks: boolean,
  ) {}

  private mention(kind: "user" | "role" | "channel", id: string): MarkdownNode {
    const table = kind === "user" ? this.ctx.users : kind === "role" ? this.ctx.roles : this.ctx.channels;
    const known = table?.[id];
    const fallback = kind === "user" ? "unknown-user" : kind === "role" ? "deleted-role" : "unknown";
    return { type: "mention", kind, id, name: known?.name || fallback, color: kind === "channel" ? null : colorOf(known?.color) };
  }

  /** The next occurrence of `delim` at or after `from` that `accept` agrees closes it, or -1. */
  private find(delim: string, from: number, end: number, accept: (at: number) => boolean): number {
    const key = `${delim}:${end}`;
    const missed = this.misses.get(key);
    if (missed !== undefined && from >= missed) return -1;
    let at = this.src.indexOf(delim, from);
    while (at !== -1 && at + delim.length <= end) {
      if (accept(at)) return at;
      at = this.src.indexOf(delim, at + 1);
    }
    if (missed === undefined || from < missed) this.misses.set(key, from);
    return -1;
  }

  private escapedAt(at: number): boolean {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && this.src[i] === "\\"; i--) slashes++;
    return slashes % 2 === 1;
  }

  parse(start: number, end: number, depth: number, inSpoiler: boolean, inLink: boolean): MarkdownNode[] {
    const src = this.src;
    const out: MarkdownNode[] = [];
    let text = "";
    const flush = () => {
      textNodes(text, out);
      text = "";
    };
    const nested = depth < MARKDOWN_MAX_DEPTH;
    let i = start;

    while (i < end) {
      const ch = src[i]!;

      if (ch === "\\" && i + 1 < end && ESCAPABLE.has(src[i + 1]!)) {
        text += src[i + 1];
        i += 2;
        continue;
      }

      if (ch === "\n") {
        flush();
        out.push({ type: "br" });
        i++;
        continue;
      }

      if (ch === "`") {
        const ticks = src.startsWith("``", i) ? 2 : 1;
        const delim = "`".repeat(ticks);
        const close = this.find(delim, i + ticks + 1, end, (at) => (ticks === 1 ? true : src[at + 2] !== "`"));
        if (close !== -1) {
          let value = src.slice(i + ticks, close);
          if (ticks === 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") value = value.slice(1, -1);
          if (value.trim() !== "") {
            flush();
            out.push({ type: "code", value });
            i = close + ticks;
            continue;
          }
        }
        text += delim;
        i += ticks;
        continue;
      }

      if (ch === "<") {
        const node = this.angle(i, end);
        if (node) {
          flush();
          out.push(node.node);
          i = node.next;
          continue;
        }
      }

      if (ch === "@" && (src.startsWith("@everyone", i) || src.startsWith("@here", i))) {
        const kind = src.startsWith("@everyone", i) ? "everyone" : "here";
        flush();
        out.push({ type: "mention", kind, id: null, name: kind, color: null });
        i += kind.length + 1;
        continue;
      }

      if (ch === "h" && !inLink && (src.startsWith("https://", i) || src.startsWith("http://", i))) {
        const before = i > start ? src[i - 1]! : " ";
        if (!/[A-Za-z0-9]/.test(before)) {
          BARE_LINK.lastIndex = i;
          const match = BARE_LINK.exec(src);
          if (match) {
            const raw = trimLink(match[0].slice(0, end - i));
            const url = linkable(raw);
            if (url) {
              flush();
              out.push({ type: "link", url, children: [{ type: "text", value: raw }] });
              i += raw.length;
              continue;
            }
          }
        }
      }

      if (ch === "[" && this.maskedLinks && !inLink && nested) {
        MASKED_LINK.lastIndex = i;
        const found = MASKED_LINK.exec(src);
        const match = found && i + found[0].length <= end ? found : null;
        if (match) {
          const url = linkable(match[2]!);
          if (url) {
            flush();
            const labelStart = i + 1;
            out.push({ type: "link", url, children: this.parse(labelStart, labelStart + match[1]!.length, depth + 1, inSpoiler, true) });
            i += match[0].length;
            continue;
          }
        }
      }

      if (nested && (ch === "*" || ch === "_" || ch === "~" || ch === "|")) {
        const wrapped = this.wrapped(i, end, depth, inSpoiler, inLink);
        if (wrapped) {
          flush();
          out.push(...wrapped.nodes);
          i = wrapped.next;
          continue;
        }
      }

      text += ch;
      i++;
    }
    flush();
    return out;
  }

  private angle(i: number, end: number): { node: MarkdownNode; next: number } | null {
    const at = (pattern: RegExp) => {
      pattern.lastIndex = i;
      const match = pattern.exec(this.src);
      return match && i + match[0].length <= end ? match : null;
    };
    let match = at(USER_MENTION);
    if (match) return { node: this.mention("user", match[1]!), next: i + match[0].length };
    match = at(ROLE_MENTION);
    if (match) return { node: this.mention("role", match[1]!), next: i + match[0].length };
    match = at(CHANNEL_MENTION);
    if (match) return { node: this.mention("channel", match[1]!), next: i + match[0].length };
    match = at(CUSTOM_EMOJI);
    if (match) return { node: { type: "emoji", animated: match[1] === "a", name: match[2]!, id: match[3]! }, next: i + match[0].length };
    match = at(TIMESTAMP);
    if (match) {
      const unix = Number(match[1]);
      if (Number.isSafeInteger(unix) && Math.abs(unix) <= 8_640_000_000_000) {
        return { node: { type: "timestamp", unix, style: match[2] ?? "f" }, next: i + match[0].length };
      }
    }
    match = at(COMMAND_MENTION);
    if (match) return { node: { type: "mention", kind: "command", id: match[2]!, name: match[1]!, color: null }, next: i + match[0].length };
    match = at(ANGLE_LINK);
    if (match) {
      const url = linkable(match[1]!);
      if (url) return { node: { type: "link", url, children: [{ type: "text", value: match[1]! }] }, next: i + match[0].length };
    }
    return null;
  }

  /** Bold, italics, underline, strikethrough and spoilers, the delimiters Discord pairs. */
  private wrapped(i: number, end: number, depth: number, inSpoiler: boolean, inLink: boolean): { nodes: MarkdownNode[]; next: number } | null {
    const src = this.src;
    const inner = (from: number, to: number, spoiler = inSpoiler) => this.parse(from, to, depth + 1, spoiler, inLink);
    const notSpace = (at: number) => at < src.length && !/\s/.test(src[at]!);

    if (src.startsWith("||", i)) {
      const close = this.find("||", i + 3, end, (at) => !this.escapedAt(at));
      if (close === -1) return null;
      const children = inner(i + 2, close, true);
      return { nodes: inSpoiler ? children : [{ type: "spoiler", children }], next: close + 2 };
    }

    if (src.startsWith("~~", i)) {
      const close = this.find("~~", i + 3, end, (at) => !this.escapedAt(at));
      if (close === -1) return null;
      return { nodes: [{ type: "strike", children: inner(i + 2, close) }], next: close + 2 };
    }

    if (src.startsWith("**", i)) {
      // The closing pair is the last two of a run, so `***bold italic***` closes on its final two.
      const close = this.find("**", i + 3, end, (at) => (at + 2 >= end || src[at + 2] !== "*") && !this.escapedAt(at));
      if (close !== -1) return { nodes: [{ type: "strong", children: inner(i + 2, close) }], next: close + 2 };
    }

    if (src.startsWith("__", i)) {
      const close = this.find("__", i + 3, end, (at) => (at + 2 >= end || src[at + 2] !== "_") && !this.escapedAt(at));
      if (close !== -1) return { nodes: [{ type: "underline", children: inner(i + 2, close) }], next: close + 2 };
    }

    if (src[i] === "*" && notSpace(i + 1) && src[i + 1] !== "*") {
      const close = this.find("*", i + 2, end, (at) => (at + 1 >= end || src[at + 1] !== "*") && src[at - 1] !== "*" && !/\s/.test(src[at - 1]!) && !this.escapedAt(at));
      if (close !== -1) return { nodes: [{ type: "em", children: inner(i + 1, close) }], next: close + 1 };
    }

    if (src[i] === "_" && src[i + 1] !== "_" && notSpace(i + 1)) {
      const before = i > 0 ? src[i - 1]! : " ";
      if (!/[A-Za-z0-9]/.test(before)) {
        const close = this.find("_", i + 2, end, (at) => {
          const after = at + 1 < end ? src[at + 1]! : " ";
          return !/[A-Za-z0-9_]/.test(after) && src[at - 1] !== "_" && !this.escapedAt(at);
        });
        if (close !== -1) return { nodes: [{ type: "em", children: inner(i + 1, close) }], next: close + 1 };
      }
    }
    return null;
  }
}

/** Splits text on code blocks first, since nothing inside one is markdown. */
function codeBlocks(src: string): ({ code: false; text: string } | { code: true; lang: string; value: string })[] {
  const parts: ({ code: false; text: string } | { code: true; lang: string; value: string })[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("```", i);
    if (open === -1) break;
    const close = src.indexOf("```", open + 3);
    if (close === -1) break;
    let body = src.slice(open + 3, close);
    let lang = "";
    const firstLine = /^([A-Za-z0-9_+#.-]{1,24})\n/.exec(body);
    if (firstLine && body.slice(firstLine[0].length).trim() !== "") {
      lang = firstLine[1]!;
      body = body.slice(firstLine[0].length);
    } else if (body.startsWith("\n")) {
      body = body.slice(1);
    }
    if (body.endsWith("\n")) body = body.slice(0, -1);
    if (body.trim() === "" && lang === "") {
      i = close + 3;
      parts.push({ code: false, text: src.slice(open, close + 3) });
      continue;
    }
    if (open > i) parts.push({ code: false, text: src.slice(i, open) });
    parts.push({ code: true, lang, value: body });
    i = close + 3;
    // The line break right after a block belongs to the block.
    if (src[i] === "\n") i++;
  }
  if (i < src.length) parts.push({ code: false, text: src.slice(i) });
  return parts;
}

function parseList(lines: string[], inline: (text: string) => MarkdownNode[], level = 0): MarkdownNode {
  const first = LIST_ITEM.exec(lines[0]!)!;
  const baseIndent = first[1]!.length;
  const ordered = first[2] !== "-" && first[2] !== "*";
  const items: MarkdownNode[][] = [];
  let k = 0;
  while (k < lines.length) {
    const match = LIST_ITEM.exec(lines[k]!)!;
    const content = inline(match[3]!);
    k++;
    const childLines: string[] = [];
    while (k < lines.length && LIST_ITEM.exec(lines[k]!)![1]!.length > baseIndent) childLines.push(lines[k++]!);
    if (childLines.length > 0 && level < 2) content.push(parseList(childLines, inline, level + 1));
    else for (const line of childLines) content.push({ type: "br" }, ...inline(LIST_ITEM.exec(line)![3]!));
    items.push(content);
  }
  return { type: "list", ordered, start: ordered ? Math.min(Number(first[2]!.slice(0, -1)) || 1, 999_999_999) : 1, items };
}

function blocks(text: string, ctx: MarkdownContext, options: MarkdownOptions, depth: number, inQuote: boolean): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  const inline = (value: string) => new Inline(value, ctx, options.maskedLinks !== false).parse(0, value.length, depth, false, false);
  const lines = text.split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push(...inline(paragraph.join("\n")));
    paragraph = [];
  };

  let k = 0;
  while (k < lines.length) {
    const line = lines[k]!;

    if (!inQuote && line.startsWith(">>> ")) {
      flush();
      const rest = [line.slice(4), ...lines.slice(k + 1)].join("\n");
      out.push({ type: "quote", children: blocks(rest, ctx, options, depth + 1, true) });
      return out;
    }

    if (!inQuote && (line.startsWith("> ") || line === ">")) {
      flush();
      const quoted: string[] = [];
      while (k < lines.length && (lines[k]!.startsWith("> ") || lines[k] === ">")) quoted.push(lines[k++]!.slice(2));
      out.push({ type: "quote", children: blocks(quoted.join("\n"), ctx, options, depth + 1, true) });
      continue;
    }

    const heading = /^(#{1,3}) +(\S.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, children: inline(heading[2]!) });
      k++;
      continue;
    }

    const subtext = /^-# +(\S.*)$/.exec(line);
    if (subtext) {
      flush();
      out.push({ type: "subtext", children: inline(subtext[1]!) });
      k++;
      continue;
    }

    if (LIST_ITEM.test(line) && LIST_ITEM.exec(line)![1]!.length === 0) {
      flush();
      const listLines: string[] = [];
      const ordered = (value: string) => /^\d/.test(LIST_ITEM.exec(value)![2]!);
      const kind = ordered(line);
      while (k < lines.length && LIST_ITEM.test(lines[k]!)) {
        const item = LIST_ITEM.exec(lines[k]!)!;
        // A new kind of list at the left edge starts a list of its own.
        if (item[1]!.length === 0 && ordered(lines[k]!) !== kind) break;
        listLines.push(lines[k++]!);
      }
      out.push(parseList(listLines, inline));
      continue;
    }

    if (paragraph.length === 0 && line === "" && out.length > 0 && out[out.length - 1]!.type !== "br" && k < lines.length - 1) {
      // A blank line after a block reads as one line of space, as in Discord.
      out.push({ type: "br" });
      k++;
      continue;
    }
    paragraph.push(line);
    k++;
  }
  flush();
  return out;
}

/**
 * Reads Discord markdown into a tree. Mentions are resolved against `ctx`; an
 * id it does not know reads the way Discord shows one it cannot resolve.
 */
export function parseDiscordMarkdown(input: string, ctx: MarkdownContext = {}, options: MarkdownOptions = {}): MarkdownNode[] {
  const normalized = input.replace(/\r\n?/g, "\n");
  const src = normalized.length > MARKDOWN_MAX_INPUT ? normalized.slice(0, MARKDOWN_MAX_INPUT) : normalized;
  const rest = normalized.length > MARKDOWN_MAX_INPUT ? normalized.slice(MARKDOWN_MAX_INPUT) : "";

  const out: MarkdownNode[] = [];
  if (options.inline) {
    out.push(...new Inline(src, ctx, options.maskedLinks !== false).parse(0, src.length, 0, false, false).filter((node) => node.type !== "br"));
  } else {
    for (const part of codeBlocks(src)) {
      if (part.code) out.push({ type: "codeblock", lang: part.lang, value: part.value });
      else out.push(...blocks(part.text, ctx, options, 0, false));
    }
  }
  if (rest !== "") out.push({ type: "text", value: rest });
  return out;
}

/** Whether a message is nothing but emoji, which Discord draws large. Up to 30 of them, like the client. */
export function isEmojiOnly(nodes: readonly MarkdownNode[]): boolean {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "emoji" || node.type === "unicodeEmoji") count++;
    else if (node.type === "text" && node.value.trim() === "") continue;
    else return false;
  }
  return count > 0 && count <= 30;
}

/** The text a tree reads as, for a reply's one-line preview. */
export function markdownPlainText(nodes: readonly MarkdownNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "br":
        out += " ";
        break;
      case "code":
      case "codeblock":
        out += node.value;
        break;
      case "unicodeEmoji":
        out += node.value;
        break;
      case "emoji":
        out += `:${node.name}:`;
        break;
      case "mention":
        out += node.kind === "channel" ? `#${node.name}` : node.kind === "command" ? `/${node.name}` : `@${node.name}`;
        break;
      case "timestamp":
        out += `<t:${node.unix}>`;
        break;
      case "list":
        out += node.items.map((item) => markdownPlainText(item)).join(" ");
        break;
      case "spoiler":
        out += "▮▮▮▮";
        break;
      default:
        out += markdownPlainText(node.children);
    }
  }
  return out;
}
