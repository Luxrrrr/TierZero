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
