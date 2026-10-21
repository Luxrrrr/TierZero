import { emptyEmbed, readButtons, readSelects, type MessageEmbed } from "@tier0/core";
import type { MessageDraft } from "../components/messages/MessageForm";

/**
 * A message as JSON, so it can be copied out of here or built somewhere else and
 * pasted in. The text and embeds are written the way Discord's API writes them.
 * Buttons, menus and reactions follow in the form this dashboard keeps them,
 * since Discord's own form has nowhere to put what a button does. When pasted
 * code leaves one of those out, what the message already has is kept.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function colorToNumber(color: string): number | undefined {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? parseInt(color.slice(1), 16) : undefined;
}

function colorFrom(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, "0")}`;
  if (typeof value === "string") {
    const hex = value.trim().replace(/^0x/i, "#");
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  }
  return "";
}

function embedToCode(embed: MessageEmbed): Json {
  const out: Json = {};
  if (embed.title) out.title = embed.title;
  if (embed.description) out.description = embed.description;
  if (embed.url) out.url = embed.url;
  const color = colorToNumber(embed.color);
  if (color !== undefined) out.color = color;
  if (embed.authorName || embed.authorIconUrl || embed.authorUrl) {
    out.author = { name: embed.authorName, ...(embed.authorUrl ? { url: embed.authorUrl } : {}), ...(embed.authorIconUrl ? { icon_url: embed.authorIconUrl } : {}) };
  }
  if (embed.thumbnailUrl) out.thumbnail = { url: embed.thumbnailUrl };
  if (embed.imageUrl) out.image = { url: embed.imageUrl };
  if (embed.fields.length > 0) out.fields = embed.fields.map((field) => ({ name: field.name, value: field.value, ...(field.inline ? { inline: true } : {}) }));
  if (embed.footerText || embed.footerIconUrl) out.footer = { text: embed.footerText, ...(embed.footerIconUrl ? { icon_url: embed.footerIconUrl } : {}) };
  if (embed.timestamp) out.timestamp = embed.timestamp;
  return out;
}

/** The whole message as formatted JSON. Buttons, menus and reactions are left out while there are none. */
export function toCode(draft: MessageDraft): string {
  const out: Json = {};
  if (draft.content) out.content = draft.content;
  out.embeds = draft.embeds.map(embedToCode);
  if (draft.buttons.length > 0) out.buttons = draft.buttons;
  if (draft.selects.length > 0) out.selects = draft.selects;
  if (draft.reactions.length > 0) out.reactions = draft.reactions;
  return JSON.stringify(out, null, 2);
}

function embedFromCode(raw: Json, name: string): MessageEmbed {
  const embed = emptyEmbed();
  embed.name = name;
  embed.title = str(raw.title);
  embed.description = str(raw.description);
  embed.url = str(raw.url);
  embed.color = colorFrom(raw.color);
  embed.timestamp = str(raw.timestamp);
  if (isRecord(raw.author)) {
    embed.authorName = str(raw.author.name);
    embed.authorUrl = str(raw.author.url);
    embed.authorIconUrl = str(raw.author.icon_url ?? raw.author.iconUrl);
  }
  if (isRecord(raw.footer)) {
    embed.footerText = str(raw.footer.text);
    embed.footerIconUrl = str(raw.footer.icon_url ?? raw.footer.iconUrl);
  }
  if (isRecord(raw.image)) embed.imageUrl = str(raw.image.url);
  if (isRecord(raw.thumbnail)) embed.thumbnailUrl = str(raw.thumbnail.url);
  if (Array.isArray(raw.fields)) {
    embed.fields = raw.fields.filter(isRecord).map((field) => ({ name: str(field.name), value: str(field.value), inline: field.inline === true }));
  }
  return embed;
}

const EMBED_KEYS = ["title", "description", "fields", "author", "footer", "image", "thumbnail", "color", "url"];

export type CodeResult = { ok: true; value: MessageDraft } | { ok: false; error: string };

/**
 * Reads pasted JSON back into a message. It takes a whole message, a message
 * with one `embed`, a list of embeds, or a single embed on its own. Anything the
 * code leaves out, the text, the buttons, the menus or the reactions, is kept as
 * it is, so pasting just an embed doesn't wipe the rest.
 */
export function fromCode(text: string, current: MessageDraft): CodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `That isn't valid JSON: ${error instanceof Error ? error.message : "it could not be read"}.` };
  }

  let content = current.content;
  let buttons = current.buttons;
  let selects = current.selects;
  let reactions = current.reactions;
  let keepEmbeds = false;
  let rawEmbeds: unknown[];
  if (Array.isArray(parsed)) {
    rawEmbeds = parsed;
  } else if (isRecord(parsed)) {
    if (typeof parsed.content === "string") content = parsed.content;
    if ("buttons" in parsed) buttons = readButtons(parsed.buttons);
    if ("selects" in parsed) selects = readSelects(parsed.selects);
    if ("reactions" in parsed) reactions = (Array.isArray(parsed.reactions) ? parsed.reactions : []).filter((entry): entry is string => typeof entry === "string");
    const hasComponents = "buttons" in parsed || "selects" in parsed || "reactions" in parsed;
    if (Array.isArray(parsed.embeds)) rawEmbeds = parsed.embeds;
    else if (isRecord(parsed.embed)) rawEmbeds = [parsed.embed];
    else if (EMBED_KEYS.some((key) => key in parsed)) rawEmbeds = [parsed];
    else if ("content" in parsed || hasComponents) {
      rawEmbeds = [];
      keepEmbeds = true;
    }
    else return { ok: false, error: "This has no content, embeds, buttons or menus in it. Expected a message, or an embed." };
  } else {
    return { ok: false, error: "Expected a message or an embed written as a JSON object." };
  }

  const embeds: MessageEmbed[] = [];
  for (const [index, entry] of rawEmbeds.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Embed ${index + 1} should be an object.` };
    embeds.push(embedFromCode(entry, current.embeds[index]?.name ?? ""));
  }
  return { ok: true, value: { content, embeds: keepEmbeds ? current.embeds : embeds, buttons, selects, reactions } };
}
