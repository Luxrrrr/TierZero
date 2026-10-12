import {
  MESSAGE_LIMITS,
  checkEmbed,
  embedLength,
  isEmojiToken,
  isHttpUrl,
  isRecord,
  readEmbed,
  text,
  tooLong,
  type MessageEmbed,
  type MessageError,
} from "./embed.js";
import {
  checkButtons,
  checkSelects,
  readButtons,
  readSelects,
  rowsUsed,
  type MessageButton,
  type MessageSelect,
} from "./components.js";

export * from "./embed.js";

/**
 * The shape of a message an owner builds in the dashboard, and the rules
 * Discord holds it to. The dashboard checks as the owner types, and the bot
 * checks again before saving or sending, so a template that was saved is one
 * that can be sent.
 */

export interface MessageBody {
  content: string;
  embeds: MessageEmbed[];
  /** Placed in rows of five, in order, above any menus. */
  buttons: MessageButton[];
  /** Each takes a row of its own. */
  selects: MessageSelect[];
  /** Added under the message once it is sent. */
  reactions: string[];
}

/**
 * Reads whatever came over the wire into a message, filling anything missing
 * with its empty value, then checks it against Discord's limits. Strings are
 * kept as typed apart from line endings, so what the owner sees is what is sent.
 */
export function parseMessage(
  input: unknown,
): { ok: true; value: MessageBody } | { ok: false; errors: MessageError[] } {
  const errors: MessageError[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "", message: "The message must be an object." }] };
  }

  const content = text(input.content).replace(/\r\n/g, "\n");
  const embeds = (Array.isArray(input.embeds) ? input.embeds : []).map(readEmbed);
  const buttons = readButtons(input.buttons);
  const selects = readSelects(input.selects);
  const rawReactions = Array.isArray(input.reactions) ? input.reactions : [];
  const reactions = [...new Set(rawReactions.map((r) => text(r).trim()).filter((r) => r !== ""))];

  const L = MESSAGE_LIMITS;
  tooLong(errors, "content", content, L.content, "The message text");
  if (embeds.length > L.embeds) {
    errors.push({ path: "embeds", message: `A message can have at most ${L.embeds} embeds.` });
  }

  let total = 0;
  embeds.forEach((embed, i) => {
    total += embedLength(embed);
    checkEmbed(embed, `embeds[${i}]`, errors);
  });
  if (total > L.embedTotal) {
    errors.push({
      path: "embeds",
      message: `The embeds hold ${total} characters between them. Discord allows ${L.embedTotal} in one message.`,
    });
  }

  checkButtons(buttons, errors);
  checkSelects(selects, errors);
  if (rowsUsed(buttons, selects) > L.rows) {
    errors.push({
      path: "buttons",
      message: `Buttons and menus fit in ${L.rows} rows, five buttons to a row and a menu on a row of its own. This message needs ${rowsUsed(buttons, selects)}.`,
    });
  }

  if (reactions.length > L.reactions) {
    errors.push({ path: "reactions", message: `A message can carry at most ${L.reactions} reactions.` });
  }
  reactions.forEach((reaction, i) => {
    if (!isEmojiToken(reaction)) errors.push({ path: `reactions[${i}]`, message: `"${reaction}" is not an emoji.` });
  });

  if (content.trim() === "" && embeds.length === 0) {
    errors.push({ path: "", message: "Add some text or at least one embed." });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { content, embeds, buttons, selects, reactions } };
}

/** A name for a template or folder: trimmed, never empty, no longer than `max`. */
export function cleanName(
  value: unknown,
  max: number,
  label: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const name = text(value).replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, error: `${label} cannot be empty.` };
  if (name.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` };
  return { ok: true, value: name };
}

export interface MessageFolderDto {
  id: number;
  name: string;
}

export interface MessageTemplateDto extends MessageBody {
  id: number;
  /** Null for a template that sits outside every folder. */
  folderId: number | null;
  name: string;
  updatedAt: string;
  lastSentAt: string | null;
}

export interface MessageLibrary {
  folders: MessageFolderDto[];
  templates: MessageTemplateDto[];
}

/** What the dashboard offers to put into text, and what each one becomes when the message is sent. */
export const MESSAGE_VARIABLES = [
  { name: "server", description: "The server's name" },
  { name: "members", description: "How many members the server has" },
  { name: "channel", description: "The channel it is sent to, as a link" },
  { name: "channel.name", description: "The channel's name" },
  { name: "date", description: "Today's date" },
  { name: "time", description: "The time it is sent" },
  { name: "now", description: "The date and time it is sent" },
  { name: "sender", description: "Who sent it from the dashboard" },
  { name: "bot", description: "The bot's name" },
  { name: "server.icon", description: "The server's icon, for an image or thumbnail" },
] as const;

export type VariableValues = Record<string, string>;

/** Fills `{name}` for every name above and leaves any other braces exactly as typed. */
export function applyVariables(value: string, values: VariableValues): string {
  return value.replace(/\{([a-z][a-z.]*)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? whole) : whole,
  );
}

/**
 * Applies variables to every piece of text a message shows, and to the addresses
 * of its pictures so an icon can come from a variable. A link someone follows,
 * the title link and a button's address, is left exactly as written. What a
 * button or a menu does when it is used is left alone too: it is filled in then,
 * for the person who used it.
 */
export function applyVariablesToMessage(message: MessageBody, values: VariableValues): MessageBody {
  const fill = (value: string) => applyVariables(value, values);
  return {
    content: fill(message.content),
    embeds: message.embeds.map((embed) => ({
      ...embed,
      title: fill(embed.title),
      description: fill(embed.description),
      authorName: fill(embed.authorName),
      footerText: fill(embed.footerText),
      imageUrl: fill(embed.imageUrl),
      thumbnailUrl: fill(embed.thumbnailUrl),
      authorIconUrl: fill(embed.authorIconUrl),
      footerIconUrl: fill(embed.footerIconUrl),
      fields: embed.fields.map((field) => ({ ...field, name: fill(field.name), value: fill(field.value) })),
    })),
    buttons: message.buttons.map((button) => ({ ...button, label: fill(button.label) })),
    selects: message.selects.map((select) => ({
      ...select,
      placeholder: fill(select.placeholder),
      options: select.options.map((option) => ({ ...option, label: fill(option.label), description: fill(option.description) })),
    })),
    reactions: message.reactions,
  };
}

/** The ways Discord can show a time, which it works out in each reader's own timezone. */
export const TIMESTAMP_STYLES = [
  { id: "t", label: "Short time", example: "4:12 PM" },
  { id: "T", label: "Long time", example: "4:12:30 PM" },
  { id: "d", label: "Short date", example: "10/11/2026" },
  { id: "D", label: "Long date", example: "October 11, 2026" },
  { id: "f", label: "Date and time", example: "October 11, 2026 4:12 PM" },
  { id: "F", label: "Full date and time", example: "Sunday, October 11, 2026 4:12 PM" },
  { id: "R", label: "Relative", example: "in 3 days" },
] as const;

export type TimestampStyle = (typeof TIMESTAMP_STYLES)[number]["id"];

export function discordTimestamp(date: Date, style: TimestampStyle): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Choices made when a message is sent, as opposed to what the message says. None of them is saved with a template. */
export interface SendOptions {
  channelId: string;
  /** Sends without notifying anyone. */
  silent: boolean;
  /** Stops Discord turning links in the text into previews. */
  suppressEmbeds: boolean;
  tts: boolean;
  pin: boolean;
  /** Publishes it to followers when the channel is an announcement channel. */
  publish: boolean;
  /** When set, starts a thread on the message with this name. */
  threadName: string;
  /** A message id or link to reply to. */
  replyTo: string;
  /** Lets @everyone and @here ping. Off unless somebody turns it on. */
  allowEveryone: boolean;
  /** Sends under another name, through a webhook. Empty keeps the bot's own. */
  asName: string;
  /** The picture to go with that name. */
  asAvatarUrl: string;
}

export const SEND_NAME_MAX = 80;

export function parseSendOptions(
  input: unknown,
): { ok: true; value: SendOptions } | { ok: false; error: string } {
  const source = isRecord(input) ? input : {};
  const channelId = text(source.channelId).trim();
  if (!/^\d{17,20}$/.test(channelId)) return { ok: false, error: "Pick a channel to send it to." };

  const threadName = text(source.threadName).replace(/\s+/g, " ").trim();
  if (threadName.length > MESSAGE_LIMITS.threadName) {
    return { ok: false, error: `A thread name can be at most ${MESSAGE_LIMITS.threadName} characters.` };
  }

  const replyRaw = text(source.replyTo).trim();
  let replyTo = "";
  if (replyRaw !== "") {
    const match = /^(?:https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/)?(\d{17,20})$/.exec(replyRaw);
    if (!match?.[1]) return { ok: false, error: "Reply to needs a message ID or a link to a message." };
    replyTo = match[1];
  }

  const asName = text(source.asName).replace(/\s+/g, " ").trim();
  if (asName.length > SEND_NAME_MAX) return { ok: false, error: `A name to send as can be at most ${SEND_NAME_MAX} characters.` };
  const asAvatarUrl = text(source.asAvatarUrl).trim();
  if (asAvatarUrl !== "" && !isHttpUrl(asAvatarUrl)) {
    return { ok: false, error: "The picture to send as must be a web address starting with http:// or https://." };
  }
  if (asAvatarUrl !== "" && asName === "") {
    return { ok: false, error: "Give a name to send as, or leave the picture empty." };
  }

  return {
    ok: true,
    value: {
      channelId,
      silent: source.silent === true,
      suppressEmbeds: source.suppressEmbeds === true,
      tts: source.tts === true,
      pin: source.pin === true,
      publish: source.publish === true,
      threadName,
      replyTo,
      allowEveryone: source.allowEveryone === true,
      asName,
      asAvatarUrl,
    },
  };
}
