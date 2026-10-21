import { parseMessage, type MessageBody, type MessageEmbed } from "@tier0/core";
import type { Embed, Message } from "discord.js";

function embedOf(embed: Embed): MessageEmbed {
  return {
    name: "",
    title: embed.title ?? "",
    url: embed.url ?? "",
    description: embed.description ?? "",
    color: embed.hexColor ?? "",
    authorName: embed.author?.name ?? "",
    authorIconUrl: embed.author?.iconURL ?? "",
    authorUrl: embed.author?.url ?? "",
    footerText: embed.footer?.text ?? "",
    footerIconUrl: embed.footer?.iconURL ?? "",
    imageUrl: embed.image?.url ?? "",
    thumbnailUrl: embed.thumbnail?.url ?? "",
    timestamp: embed.timestamp ?? "",
    fields: embed.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline ?? false })),
  };
}

/**
 * What a sticky keeps of a message someone picked in Discord: its text and its
 * rich embeds. Attachments are left out, since their addresses stop working
 * after a while. Null when nothing is left or what is left breaks Discord's limits.
 */
export function bodyFromMessage(message: Pick<Message, "content" | "embeds">): MessageBody | null {
  const embeds = message.embeds.filter((embed) => embed.data.type === undefined || embed.data.type === "rich").map(embedOf);
  const body = { content: message.content, embeds, buttons: [], selects: [], reactions: [] };
  if (!body.content.trim() && embeds.length === 0) return null;
  const parsed = parseMessage(body);
  return parsed.ok ? parsed.value : null;
}
