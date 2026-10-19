import { XMLParser } from "fast-xml-parser";
import { FeedFailure } from "./failures.js";

export interface FeedItem {
  id: string;
  title: string;
  link: string | null;
  summary: string;
  publishedAt: Date | null;
  image: string | null;
}

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Feeds are untrusted input. The parser's bounded entity handling is what
  // keeps a hostile document from expanding into memory.
  processEntities: true,
});

type Node = Record<string, unknown>;

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const inner = (value as Node)["#text"];
    return inner === undefined ? "" : text(inner);
  }
  return "";
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Removes everything from an opening script or style tag to its closing tag, or
 * to the end when it is never closed. A regex for this is quadratic on text with
 * many opening tags and no closing ones, and feed text comes from strangers.
 */
function dropBlocks(html: string): string {
  const opening = /<(script|style)/gi;
  let out = "";
  let from = 0;
  for (;;) {
    opening.lastIndex = from;
    const start = opening.exec(html);
    if (!start) return out + html.slice(from);
    out += html.slice(from, start.index);
    const closing = new RegExp(`</${start[1]}>`, "gi");
    closing.lastIndex = start.index;
    const end = closing.exec(html);
    if (!end) return out;
    from = end.index + end[0].length;
  }
}

/** Removes every <...> run, the same text `/<[^>]+>/g` matches, in one pass. */
function dropTags(html: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open === -1) return out + html.slice(from);
    const close = html.indexOf(">", open + 1);
    if (close === -1) return out + html.slice(from);
    if (close === open + 1) {
      out += html.slice(from, close + 1);
    } else {
      out += html.slice(from, open);
    }
    from = close + 1;
  }
}

function codePointOf(code: string): string {
  const point = Number(code);
  return point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : "";
}

/** Feed summaries are HTML. An embed wants plain text. */
export function stripHtml(html: string): string {
  const blocks = dropBlocks(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  return dropTags(blocks)
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d{1,7});/g, (_, code: string) => codePointOf(code))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageOf(entry: Node): string | null {
  for (const key of ["media:thumbnail", "media:content"]) {
    for (const candidate of asArray(entry[key] as Node | Node[] | undefined)) {
      const url = httpUrl(text(candidate["@_url"]));
      if (url) return url;
    }
  }
  const group = entry["media:group"] as Node | undefined;
  if (group) return imageOf(group);

  for (const enclosure of asArray(entry["enclosure"] as Node | Node[] | undefined)) {
    if (text(enclosure["@_type"]).startsWith("image/")) {
      const url = httpUrl(text(enclosure["@_url"]));
      if (url) return url;
    }
  }
  return null;
}

function atomLink(value: unknown): string | null {
  const links = asArray(value as Node | string | (Node | string)[] | undefined);
  let fallback: string | null = null;
  for (const link of links) {
    if (typeof link === "string") {
      fallback ??= httpUrl(link);
      continue;
    }
    const href = httpUrl(text(link["@_href"]));
    const rel = text(link["@_rel"]);
    if (href && (rel === "" || rel === "alternate")) return href;
    fallback ??= href;
  }
  return fallback;
}

function fromRss(channel: Node): ParsedFeed {
  const items = asArray(channel["item"] as Node | Node[] | undefined).map((entry): FeedItem => {
    const link = httpUrl(text(entry["link"]));
    const title = stripHtml(text(entry["title"]));
    const body = text(entry["content:encoded"]) || text(entry["description"]);
    return {
      id: text(entry["guid"]) || link || `${title}|${text(entry["pubDate"])}`,
      title: title || "Untitled",
      link,
      summary: stripHtml(body),
      publishedAt: parseDate(entry["pubDate"]) ?? parseDate(entry["dc:date"]),
      image: imageOf(entry),
    };
  });
  return { title: stripHtml(text(channel["title"])) || null, items };
}

function fromAtom(feed: Node): ParsedFeed {
  const items = asArray(feed["entry"] as Node | Node[] | undefined).map((entry): FeedItem => {
    const link = atomLink(entry["link"]);
    const title = stripHtml(text(entry["title"]));
    const group = entry["media:group"] as Node | undefined;
    const body = text(entry["summary"]) || text(entry["content"]) || text(group?.["media:description"]);
    return {
      id: text(entry["id"]) || link || `${title}|${text(entry["updated"])}`,
      title: title || "Untitled",
      link,
      summary: stripHtml(body),
      publishedAt: parseDate(entry["published"]) ?? parseDate(entry["updated"]),
      image: imageOf(entry),
    };
  });
  return { title: stripHtml(text(feed["title"])) || null, items };
}

/** Reads RSS 2.0, RSS 1.0 and Atom. Throws when the document is none of them. */
export function parseFeed(xml: string): ParsedFeed {
  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch {
    throw new FeedFailure("notReadable");
  }

  const rss = document["rss"] as Node | undefined;
  const rdf = document["rdf:RDF"] as Node | undefined;
  const channel = (rss?.["channel"] ?? rdf?.["channel"]) as Node | undefined;
  if (channel) {
    // RSS 1.0 keeps items beside the channel rather than inside it.
    return fromRss(rdf ? { ...channel, item: rdf["item"] } : channel);
  }

  const atom = document["feed"] as Node | undefined;
  if (atom) return fromAtom(atom);

  throw new FeedFailure("notAFeed");
}
