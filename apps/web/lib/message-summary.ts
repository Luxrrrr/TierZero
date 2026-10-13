/**
 * The single line a compact message setting shows in place of a preview: the
 * first of the message's text, its first embed's title, or that embed's
 * description. Plain text only, so formatting marks are removed; variables such
 * as {user} are left as written, since they are what the owner will recognise.
 */

interface SummarizableMessage {
  content?: unknown;
  embeds?: unknown;
}

export const MESSAGE_SUMMARY_LENGTH = 110;

export function plainText(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/^\s{0,3}(?:#{1,3}\s+|>\s?|[-*]\s+)/gm, "")
    .replace(/(\*\*|__|~~|\|\||`)/g, "")
    .replace(/(^|[\s(])[*_]+(?=\S)/g, "$1")
    .replace(/(?<=\S)[*_]+(?=$|[\s).,!?:;])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = plainText(candidate);
    if (text !== "") return text;
  }
  return undefined;
}

export function messageSummary(
  message: SummarizableMessage | string | null | undefined,
  longest: number = MESSAGE_SUMMARY_LENGTH,
): string {
  let text: string | undefined;
  if (typeof message === "string") {
    text = firstText(message);
  } else if (message) {
    const first = Array.isArray(message.embeds)
      ? (message.embeds[0] as { title?: unknown; description?: unknown } | undefined)
      : undefined;
    text = firstText(message.content, first?.title, first?.description);
    if (text === undefined && Array.isArray(message.embeds) && message.embeds.length > 0) text = "Embed";
  }
  if (text === undefined) return "No text";
  return text.length > longest ? `${text.slice(0, longest - 1).trimEnd()}…` : text;
}
