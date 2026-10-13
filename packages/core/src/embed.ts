/**
 * The embed, and what Discord allows in one. Shared by the message model and
 * by the components, because a reply that a button sends can carry embeds too.
 */

/** The most characters an embed name may have. */
export const EMBED_NAME_MAX = 60;

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface MessageEmbed {
  /** A name for telling embeds apart in the editor. It is never sent to Discord. */
  name: string;
  title: string;
  /** Makes the title a link. */
  url: string;
  description: string;
  /** "#rrggbb", or empty for Discord's default bar. */
  color: string;
  authorName: string;
  authorIconUrl: string;
  authorUrl: string;
  footerText: string;
  footerIconUrl: string;
  imageUrl: string;
  thumbnailUrl: string;
  /** Empty for none, "now" for the time it is sent, a date and time as ISO text, or a variable that holds one. */
  timestamp: string;
  fields: EmbedField[];
}

export interface MessageError {
  /** Where the problem is, as `embeds[0].fields[1].value`. */
  path: string;
  message: string;
}

export const MESSAGE_LIMITS = {
  content: 2000,
  embeds: 10,
  /** Counted across every embed in one message. */
  embedTotal: 6000,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  authorName: 256,
  footerText: 2048,
  url: 2048,
  templateName: 80,
  folderName: 60,
  buttons: 25,
  buttonLabel: 80,
  selects: 5,
  /** A message holds at most five rows, and a select menu takes a whole row. */
  rows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  selectLabel: 100,
  selectDescription: 100,
  selectValue: 100,
  selectPlaceholder: 150,
  selectValues: 25,
  reactions: 20,
  threadName: 100,
  /** What a button or an option does when it replies. */
  replyEmbeds: 3,
  confirmation: 500,
} as const;

export function emptyEmbed(): MessageEmbed {
  return {
    name: "",
    title: "",
    url: "",
    description: "",
    color: "",
    authorName: "",
    authorIconUrl: "",
    authorUrl: "",
    footerText: "",
    footerIconUrl: "",
    imageUrl: "",
    thumbnailUrl: "",
    timestamp: "",
    fields: [],
  };
}

/** Characters Discord counts toward the 6000 limit for one embed. */
export function embedLength(embed: MessageEmbed): number {
  return (
    embed.title.length +
    embed.description.length +
    embed.authorName.length +
    embed.footerText.length +
    embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

/** Whether an embed would show anything at all. Discord rejects one that would not. */
export function embedHasContent(embed: MessageEmbed): boolean {
  return Boolean(
    embed.title ||
      embed.description ||
      embed.authorName ||
      embed.footerText ||
      embed.imageUrl ||
      embed.thumbnailUrl ||
      embed.fields.length > 0,
  );
}

export function isHttpUrl(value: string): boolean {
  if (value.length > MESSAGE_LIMITS.url) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The origin of a web address: scheme, host and port, with any path, query or
 * login dropped and no trailing slash. Null when the value is not an http(s)
 * address, so what is left is safe to put in front of a path.
 */
export function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MESSAGE_LIMITS.url) return null;
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A unicode emoji, or one of this server's custom emoji written the way Discord writes it. */
export function isEmojiToken(value: string): boolean {
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(value)) return true;
  return /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣)(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣)*$/u.test(
    value,
  );
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** "#e3b34a" as the number Discord takes. */
export function colorToInt(value: string): number | undefined {
  return isHexColor(value) ? parseInt(value.slice(1), 16) : undefined;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function tooLong(errors: MessageError[], path: string, value: string, max: number, label: string): void {
  if (value.length > max) errors.push({ path, message: `${label} can be at most ${max} characters.` });
}

export function badUrl(errors: MessageError[], path: string, value: string, label: string): void {
  if (value !== "" && !isHttpUrl(value)) {
    errors.push({ path, message: `${label} must be a web address starting with http:// or https://.` });
  }
}

/** A variable on its own, such as {link}, which stands for a whole value the module supplies. */
export const isWholeVariable = (value: string): boolean => /^\{[a-z][a-z.]*\}$/.test(value);

/**
 * Like `badUrl`, for the addresses in an embed. A variable that opens the
 * address is accepted as it stands because it supplies the whole address; the
 * message is checked again once the variable is filled in.
 */
function badEmbedUrl(errors: MessageError[], path: string, value: string, label: string): void {
  if (/^\{[a-z][a-z.]*\}/.test(value)) return;
  badUrl(errors, path, value, label);
}

/** Reads one embed off the wire, with anything missing filled in and the old true time read as "now". */
export function readEmbed(raw: unknown): MessageEmbed {
  const source = isRecord(raw) ? raw : {};
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  return {
    name: text(source.name).trim().slice(0, EMBED_NAME_MAX),
    title: text(source.title),
    url: text(source.url).trim(),
    description: text(source.description).replace(/\r\n/g, "\n"),
    color: text(source.color).trim(),
    authorName: text(source.authorName),
    authorIconUrl: text(source.authorIconUrl).trim(),
    authorUrl: text(source.authorUrl).trim(),
    footerText: text(source.footerText),
    footerIconUrl: text(source.footerIconUrl).trim(),
    imageUrl: text(source.imageUrl).trim(),
    thumbnailUrl: text(source.thumbnailUrl).trim(),
    timestamp: source.timestamp === true ? "now" : typeof source.timestamp === "string" ? source.timestamp.trim() : "",
    fields: rawFields.map((field) => {
      const f = isRecord(field) ? field : {};
      return { name: text(f.name), value: text(f.value).replace(/\r\n/g, "\n"), inline: f.inline === true };
    }),
  };
}

/** Checks one embed against Discord's limits, adding what is wrong to `errors`. */
export function checkEmbed(embed: MessageEmbed, at: string, errors: MessageError[]): void {
  const L = MESSAGE_LIMITS;
  tooLong(errors, `${at}.title`, embed.title, L.title, "The title");
  tooLong(errors, `${at}.description`, embed.description, L.description, "The description");
  tooLong(errors, `${at}.authorName`, embed.authorName, L.authorName, "The author name");
  tooLong(errors, `${at}.footerText`, embed.footerText, L.footerText, "The footer");
  badEmbedUrl(errors, `${at}.url`, embed.url, "The title link");
  badEmbedUrl(errors, `${at}.authorUrl`, embed.authorUrl, "The author link");
  badEmbedUrl(errors, `${at}.authorIconUrl`, embed.authorIconUrl, "The author icon");
  badEmbedUrl(errors, `${at}.footerIconUrl`, embed.footerIconUrl, "The footer icon");
  badEmbedUrl(errors, `${at}.imageUrl`, embed.imageUrl, "The image");
  badEmbedUrl(errors, `${at}.thumbnailUrl`, embed.thumbnailUrl, "The thumbnail");
  if (embed.timestamp !== "" && embed.timestamp !== "now" && !isWholeVariable(embed.timestamp) && Number.isNaN(Date.parse(embed.timestamp))) {
    errors.push({ path: `${at}.timestamp`, message: "The time must be a real date and time." });
  }
  if (embed.color !== "" && !isHexColor(embed.color)) {
    errors.push({ path: `${at}.color`, message: "The color must look like #e3b34a." });
  }
  if (embed.fields.length > L.fields) {
    errors.push({ path: `${at}.fields`, message: `An embed can have at most ${L.fields} fields.` });
  }
  embed.fields.forEach((field, j) => {
    const fat = `${at}.fields[${j}]`;
    if (field.name.trim() === "") errors.push({ path: `${fat}.name`, message: "A field needs a name." });
    if (field.value.trim() === "") errors.push({ path: `${fat}.value`, message: "A field needs a value." });
    tooLong(errors, `${fat}.name`, field.name, L.fieldName, "A field name");
    tooLong(errors, `${fat}.value`, field.value, L.fieldValue, "A field value");
  });
  if (!embedHasContent(embed)) {
    errors.push({ path: at, message: "An embed needs a title, description, field, image or footer." });
  }
}
