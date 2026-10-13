import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  MentionableSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  type ChannelType,
  type Guild,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { colorToInt, type MessageBody, type MessageSelect } from "@tier0/core";

const BUTTONS_PER_ROW = 5;

const BUTTON_STYLE: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

/** The prefix on every id the bot gives a button or menu, which is how it knows one of its own when it is used. */
export const COMPONENT_PREFIX = "tzmsg";

export const buttonId = (index: number): string => `${COMPONENT_PREFIX}:b:${index}`;
export const selectId = (index: number): string => `${COMPONENT_PREFIX}:s:${index}`;

/** The names of a server's channels and roles, for a menu that offers only particular ones. */
export interface NameLookup {
  channels: ReadonlyMap<string, string>;
  roles: ReadonlyMap<string, string>;
  /** What a menu option says for a role or channel that has been deleted. Set from the owner's "Labels and text". */
  unknown?: { role: string; channel: string };
}

export function namesOf(guild: Guild, unknown?: NameLookup["unknown"]): NameLookup {
  return {
    channels: new Map(guild.channels.cache.map((channel) => [channel.id, channel.name])),
    roles: new Map(guild.roles.cache.map((role) => [role.id, role.name])),
    ...(unknown ? { unknown } : {}),
  };
}

/** The ids a limited menu offers that still exist. A menu whose every choice is gone cannot be sent. */
export function limitedChoices(select: MessageSelect, names: NameLookup): string[] {
  const known = select.kind === "role" ? names.roles : names.channels;
  return select.limitTo.filter((id) => known.has(id));
}

export function firstEmptyLimitedMenu(message: MessageBody, names: NameLookup): number {
  return message.selects.findIndex((select) => select.limitTo.length > 0 && limitedChoices(select, names).length === 0);
}

function selectBuilder(select: MessageSelect, index: number, names?: NameLookup): MessageActionRowComponentBuilder {
  // A menu limited to particular channels or roles is a menu of those, since Discord's own pickers can't be.
  if ((select.kind === "channel" || select.kind === "role") && select.limitTo.length > 0) {
    const known = names ? limitedChoices(select, names) : select.limitTo;
    const label = (id: string) => (select.kind === "role" ? names?.roles.get(id) ?? names?.unknown?.role ?? "Unknown role" : names?.channels.has(id) ? `# ${names.channels.get(id)}` : names?.unknown?.channel ?? "# unknown channel");
    const max = Math.max(1, Math.min(select.maxValues, known.length));
    const builder = new StringSelectMenuBuilder().setCustomId(selectId(index)).setMinValues(Math.min(select.minValues, max)).setMaxValues(max).setDisabled(select.disabled);
    if (select.placeholder.trim() !== "") builder.setPlaceholder(select.placeholder);
    builder.addOptions(known.map((id) => new StringSelectMenuOptionBuilder().setLabel(label(id).slice(0, 100)).setValue(id)));
    return builder;
  }
  const common = {
    placeholder: select.placeholder,
    min: select.minValues,
    max: select.maxValues,
  };
  const apply = <T extends { setCustomId(id: string): T; setPlaceholder(p: string): T; setMinValues(n: number): T; setMaxValues(n: number): T; setDisabled(d: boolean): T }>(builder: T): T => {
    builder.setCustomId(selectId(index)).setMinValues(common.min).setMaxValues(common.max).setDisabled(select.disabled);
    if (common.placeholder.trim() !== "") builder.setPlaceholder(common.placeholder);
    return builder;
  };

  switch (select.kind) {
    case "user":
      return apply(new UserSelectMenuBuilder());
    case "role":
      return apply(new RoleSelectMenuBuilder());
    case "mentionable":
      return apply(new MentionableSelectMenuBuilder());
    case "channel": {
      const builder = apply(new ChannelSelectMenuBuilder());
      if (select.channelTypes.length > 0) builder.setChannelTypes(select.channelTypes as ChannelType[]);
      return builder;
    }
    default: {
      const builder = apply(new StringSelectMenuBuilder());
      builder.addOptions(
        select.options.map((option) => {
          const built = new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.value).setDefault(option.default);
          if (option.description.trim() !== "") built.setDescription(option.description);
          if (option.emoji !== "") built.setEmoji(option.emoji);
          return built;
        }),
      );
      return builder;
    }
  }
}

/**
 * Turns a checked message into what discord.js sends. A link button opens its
 * address by itself. Every other button and every menu is given an id made from
 * its place in the message, which the bot looks up when it is used.
 */
export function toDiscordPayload(message: MessageBody, names?: NameLookup): {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embeds = message.embeds.map((embed) => {
    const builder = new EmbedBuilder();
    if (embed.title) builder.setTitle(embed.title);
    if (embed.url) builder.setURL(embed.url);
    if (embed.description) builder.setDescription(embed.description);
    const color = colorToInt(embed.color);
    if (color !== undefined) builder.setColor(color);
    if (embed.authorName) {
      builder.setAuthor({
        name: embed.authorName,
        ...(embed.authorIconUrl ? { iconURL: embed.authorIconUrl } : {}),
        ...(embed.authorUrl ? { url: embed.authorUrl } : {}),
      });
    }
    if (embed.footerText) {
      builder.setFooter({
        text: embed.footerText,
        ...(embed.footerIconUrl ? { iconURL: embed.footerIconUrl } : {}),
      });
    }
    if (embed.imageUrl) builder.setImage(embed.imageUrl);
    if (embed.thumbnailUrl) builder.setThumbnail(embed.thumbnailUrl);
    // "now" is the moment the payload is built, which is the moment it is sent.
    if (embed.timestamp === "now") builder.setTimestamp();
    else if (embed.timestamp !== "") builder.setTimestamp(new Date(embed.timestamp));
    if (embed.fields.length > 0) {
      builder.addFields(embed.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline })));
    }
    return builder;
  });

  const buttons = message.buttons.map((button, index) => {
    const builder = new ButtonBuilder().setStyle(BUTTON_STYLE[button.style] ?? ButtonStyle.Primary).setDisabled(button.disabled);
    if (button.style === "link") builder.setURL(button.url);
    else builder.setCustomId(buttonId(index));
    if (button.label.trim() !== "") builder.setLabel(button.label);
    if (button.emoji !== "") builder.setEmoji(button.emoji);
    return builder;
  });

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
  }
  message.selects.forEach((select, index) => {
    components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(selectBuilder(select, index, names)));
  });

  return { ...(message.content.trim() ? { content: message.content } : {}), embeds, components };
}

/** Whether anything in a message needs the bot to answer when it is used, as opposed to a link that just opens. */
export function hasInteractiveComponents(message: MessageBody): boolean {
  return message.buttons.some((button) => button.style !== "link") || message.selects.length > 0;
}
