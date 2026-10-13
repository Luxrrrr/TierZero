/** The parts of a message that say what it carried besides text and files. Optional because a partial message lacks them. */
export interface MessageExtrasSource {
  stickers?: { size: number } | null;
  embeds?: readonly unknown[] | null;
  messageSnapshots?: { size: number } | null;
  poll?: unknown;
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * A short phrase for what a message carried besides text and files, such as "1 sticker, 1 embed", for a
 * message with no text of its own to be described by. A forward has its text in the original message, not here.
 */
export function extrasOf(message: MessageExtrasSource): string {
  const parts: string[] = [];
  if (message.messageSnapshots && message.messageSnapshots.size > 0) parts.push("a forwarded message");
  if (message.stickers && message.stickers.size > 0) parts.push(count(message.stickers.size, "sticker"));
  if (message.embeds && message.embeds.length > 0) parts.push(count(message.embeds.length, "embed"));
  if (message.poll) parts.push("a poll");
  return parts.join(", ");
}
