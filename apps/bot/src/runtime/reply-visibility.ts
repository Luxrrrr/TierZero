import { MessageFlags, MessageFlagsBitField } from "discord.js";
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction } from "discord.js";

type CommandInteraction = ChatInputCommandInteraction | ContextMenuCommandInteraction;

/**
 * Forces the first response to a command to be private or public, whatever the
 * command asked for. Commands pick their own visibility when they reply, so the
 * owner's choice has to be applied where the response leaves the process.
 *
 * Only the first response is changed: that is the one whose visibility Discord
 * fixes for the whole thread. Returns a function that puts the original methods
 * back, for the router's error path, which must not be overridden itself.
 */
export function forceReplyVisibility(
  interaction: CommandInteraction,
  ephemeral: boolean,
): () => void {
  const reply = interaction.reply.bind(interaction);
  const deferReply = interaction.deferReply.bind(interaction);

  const restore = () => {
    interaction.reply = reply as typeof interaction.reply;
    interaction.deferReply = deferReply as typeof interaction.deferReply;
  };

  const withFlags = (options: unknown): Record<string, unknown> => {
    const base: Record<string, unknown> =
      typeof options === "string"
        ? { content: options }
        : { ...((options as Record<string, unknown> | undefined) ?? {}) };
    const flags = new MessageFlagsBitField((base.flags as number | undefined) ?? 0);
    if (ephemeral) flags.add(MessageFlags.Ephemeral);
    else flags.remove(MessageFlags.Ephemeral);
    // The older boolean would otherwise win over the flag it contradicts.
    delete base.ephemeral;
    return { ...base, flags: flags.bitfield };
  };

  interaction.reply = ((options: unknown) => {
    restore();
    return reply(withFlags(options) as never);
  }) as typeof interaction.reply;
  interaction.deferReply = ((options?: unknown) => {
    restore();
    return deferReply(withFlags(options) as never);
  }) as typeof interaction.deferReply;

  return restore;
}
