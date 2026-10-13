import { emptyEmbed } from "./embed.js";
import type { MessageBody } from "./message.js";

/** A `{name}` a command's reply can use, with a stand-in the dashboard shows in its preview. */
export interface ReplyPlaceholder {
  name: string;
  description: string;
  sample: string;
}

/**
 * The reply of a command an owner may rewrite from the dashboard, with the
 * same builder as a message: text, embeds, buttons and reactions.
 *
 * `starting` is where the editor begins, written to match what the command says
 * today. It is never sent by itself: until an owner saves a reply of their
 * own, the command does what its code does.
 */
export interface ResponseTemplate {
  starting: MessageBody;
  /** What is particular to this command. The variables every message has are always on offer too. */
  placeholders: ReplyPlaceholder[];
  /** A caveat about which reply this covers, when the command has several. */
  note?: string;
}

/** The values a command hands over when it asks for the owner's reply. */
export type ReplyValues = Record<string, string | number>;

/** A reply that is only a sentence. */
export function plainReply(content: string): MessageBody {
  return { content, embeds: [], buttons: [], selects: [], reactions: [] };
}

/** What a message is telling the reader, which sets the colour of its embed. */
export type ReplyKind = "error" | "success" | "info" | "warning";

/**
 * One colour per kind of message, so every default the bot sends looks like it
 * belongs to the same product. Red is a refusal or failure, green is something
 * that went through, amber is a heads-up, and gold is everything else.
 */
export const REPLY_COLOR: Record<ReplyKind, string> = {
  error: "#ed4245",
  success: "#3ba55d",
  warning: "#f5a623",
  info: "#e3b34a",
};

/**
 * A reply that is a sentence in a coloured embed. This is how the bot's own
 * messages start out. `ping` is text placed above the embed for a mention that
 * has to notify someone, because a mention inside an embed does not.
 */
export function embedReply(text: string, kind: ReplyKind = "info", options: { ping?: string; title?: string } = {}): MessageBody {
  return {
    content: options.ping ?? "",
    embeds: [{ ...emptyEmbed(), description: text, color: REPLY_COLOR[kind], ...(options.title ? { title: options.title } : {}) }],
    buttons: [],
    selects: [],
    reactions: [],
  };
}
