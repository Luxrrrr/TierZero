/**
 * Checks on a message's text that help the person writing it, as opposed to
 * the rules that stop a save. Free of React so the tests can import it directly.
 */

export interface MessageText {
  content: string;
  embeds: {
    title: string;
    description: string;
    url: string;
    authorName: string;
    authorUrl: string;
    authorIconUrl: string;
    footerText: string;
    footerIconUrl: string;
    imageUrl: string;
    thumbnailUrl: string;
    timestamp: string;
    fields: { name: string; value: string }[];
  }[];
  buttons: { label: string; url?: string; style?: string }[];
  selects: { placeholder: string; options: { label: string; description: string }[] }[];
}

/** The same shape `applyVariables` fills; anything else in braces is sent exactly as typed. */
const VARIABLE = /\{([a-zA-Z][a-zA-Z0-9.]*)\}/g;

/** Every piece of text the bot fills variables into before sending. */
function texts(message: MessageText): string[] {
  return [
    message.content,
    ...message.embeds.flatMap((embed) => [
      embed.title,
      embed.description,
      embed.url,
      embed.authorName,
      embed.authorUrl,
      embed.authorIconUrl,
      embed.footerText,
      embed.footerIconUrl,
      embed.imageUrl,
      embed.thumbnailUrl,
      embed.timestamp,
      ...embed.fields.flatMap((field) => [field.name, field.value]),
    ]),
    ...message.buttons.flatMap((button) => [button.label, button.url ?? ""]),
    ...message.selects.flatMap((select) => [select.placeholder, ...select.options.flatMap((option) => [option.label, option.description])]),
  ];
}

/** Names written as `{name}` that this message does not know, in the order they first appear. */
export function unknownVariables(message: MessageText, known: Iterable<string>): string[] {
  const allowed = new Set(known);
  const found: string[] = [];
  for (const text of texts(message)) {
    for (const match of text.matchAll(VARIABLE)) {
      const name = match[1];
      if (name && !allowed.has(name) && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

export interface MentionToken {
  token: string;
  kind: "channel" | "role" | "user";
  id: string;
}

/**
 * The raw mentions in a piece of text, such as `<#1200000000000000008>`, each
 * once. Discord stores mentions this way and the text box has to show them as
 * they are, so the editor lists what each one is beside it.
 */
export function mentionTokens(text: string): MentionToken[] {
  const found: MentionToken[] = [];
  for (const match of text.matchAll(/<(#|@&|@!?)(\d{17,20})>/g)) {
    const [token, sigil, id] = match;
    if (!id || found.some((entry) => entry.token === token)) continue;
    found.push({ token, kind: sigil === "#" ? "channel" : sigil === "@&" ? "role" : "user", id });
  }
  return found;
}

/** Whether a picture's address only exists once the bot fills a variable in, so the preview cannot load it. */
export function comesFromVariable(address: string): boolean {
  return /\{[a-zA-Z][a-zA-Z0-9.]*\}/.test(address);
}
