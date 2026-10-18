import { Events, type Client, type Guild } from "discord.js";
import type { EventHandlers, ModuleContext } from "@tier0/core";
import { parseCustomId } from "@tier0/core";
import type { GuildState } from "./guild-state.js";
import { rememberOwnMessage, takeOwnMessage } from "./own-messages.js";
import { replySystem } from "./system-messages.js";

interface Deps {
  client: Client;
  state: GuildState;
}

/**
 * Modules that hear message events before the others. A ticket's conversation
 * is shown live in the dashboard, so storing a message must not wait behind
 * another module's slower work on the same message.
 */
const MESSAGE_FIRST = new Set(["tickets"]);

/**
 * Delivers one event to every enabled module that declares a handler for it.
 *
 * Each module is called inside its own try/catch, so one module's bug cannot
 * stop delivery to the others or take the gateway connection down with it.
 */
async function deliver(
  state: GuildState,
  guild: Guild,
  event: keyof EventHandlers,
  run: (handler: never, ctx: ModuleContext) => Promise<void>,
): Promise<void> {
  const enabled = await state.enabledModules(guild.id);
  const modules = event.startsWith("message") ? [...enabled].sort((a, b) => Number(MESSAGE_FIRST.has(b.id)) - Number(MESSAGE_FIRST.has(a.id))) : enabled;
  for (const module of modules) {
    const handler = module.events?.[event];
    if (!handler) continue;

    const ctx = await state.context(guild, module.id);
    if (!ctx) continue;

    try {
      // The handler's argument types vary per event and are checked at the
      // call sites below; they cannot be expressed once for the whole map.
      await run(handler as never, ctx);
    } catch (error) {
      console.error(`[${module.id}] ${event} handler failed:`, error);
    }
  }
}

export function registerEventDispatch({ client, state }: Deps): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.id === client.user?.id) rememberOwnMessage(message.id);
    if (message.author.bot || !message.guild) return;
    const guild = message.guild;
    await deliver(state, guild, "messageCreate", (handler, ctx) =>
      (handler as EventHandlers["messageCreate"])(message, ctx),
    );
  });

  client.on(Events.MessageDelete, async (message) => {
    // The bot's own short-lived posts are not worth an entry in any log.
    if (takeOwnMessage(message.id)) return;
    if (!message.guild) return;
    const guild = message.guild;
    await deliver(state, guild, "messageDelete", (handler, ctx) =>
      (handler as EventHandlers["messageDelete"])(message, ctx),
    );
  });

  // A purge deletes many at once and Discord reports it as one event. Modules get it as one,
  // since a purge of a hundred messages is a single thing that happened, not a hundred.
  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (channel.isDMBased()) return;
    const guild = channel.guild;
    await deliver(state, guild, "messageDeleteBulk", (handler, ctx) =>
      (handler as EventHandlers["messageDeleteBulk"])(messages, channel, ctx),
    );
  });

  client.on(Events.MessageUpdate, async (before, after) => {
    if (!after.guild) return;
    const guild = after.guild;
    await deliver(state, guild, "messageUpdate", (handler, ctx) =>
      (handler as EventHandlers["messageUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await deliver(state, member.guild, "memberJoin", (handler, ctx) =>
      (handler as EventHandlers["memberJoin"])(member, ctx),
    );
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await deliver(state, member.guild, "memberLeave", (handler, ctx) =>
      (handler as EventHandlers["memberLeave"])(member, ctx),
    );
  });

  client.on(Events.GuildMemberUpdate, async (before, after) => {
    await deliver(state, after.guild, "memberUpdate", (handler, ctx) =>
      (handler as EventHandlers["memberUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.ChannelCreate, async (channel) => {
    await deliver(state, channel.guild, "channelCreate", (handler, ctx) =>
      (handler as EventHandlers["channelCreate"])(channel, ctx),
    );
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (channel.isDMBased()) return;
    await deliver(state, channel.guild, "channelDelete", (handler, ctx) =>
      (handler as EventHandlers["channelDelete"])(channel, ctx),
    );
  });

  client.on(Events.ChannelUpdate, async (before, after) => {
    if (before.isDMBased() || after.isDMBased()) return;
    await deliver(state, after.guild, "channelUpdate", (handler, ctx) =>
      (handler as EventHandlers["channelUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.ThreadCreate, async (thread) => {
    await deliver(state, thread.guild, "threadCreate", (handler, ctx) =>
      (handler as EventHandlers["threadCreate"])(thread, ctx),
    );
  });

  client.on(Events.ThreadDelete, async (thread) => {
    await deliver(state, thread.guild, "threadDelete", (handler, ctx) =>
      (handler as EventHandlers["threadDelete"])(thread, ctx),
    );
  });

  client.on(Events.GuildRoleUpdate, async (before, after) => {
    await deliver(state, after.guild, "roleUpdate", (handler, ctx) =>
      (handler as EventHandlers["roleUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.GuildUpdate, async (before, after) => {
    await deliver(state, after, "guildUpdate", (handler, ctx) =>
      (handler as EventHandlers["guildUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.VoiceStateUpdate, async (before, after) => {
    await deliver(state, after.guild, "voiceStateUpdate", (handler, ctx) =>
      (handler as EventHandlers["voiceStateUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild || !("channels" in invite.guild)) return;
    const guild = client.guilds.cache.get(invite.guild.id);
    if (!guild) return;
    await deliver(state, guild, "inviteCreate", (handler, ctx) => (handler as EventHandlers["inviteCreate"])(invite, ctx));
  });

  client.on(Events.InviteDelete, async (invite) => {
    const guild = invite.guild ? client.guilds.cache.get(invite.guild.id) : undefined;
    if (!guild) return;
    await deliver(state, guild, "inviteDelete", (handler, ctx) => (handler as EventHandlers["inviteDelete"])(invite, ctx));
  });

  client.on(Events.GuildEmojiCreate, async (emoji) => {
    await deliver(state, emoji.guild, "emojiCreate", (handler, ctx) => (handler as EventHandlers["emojiCreate"])(emoji, ctx));
  });

  client.on(Events.GuildEmojiUpdate, async (before, after) => {
    await deliver(state, after.guild, "emojiUpdate", (handler, ctx) =>
      (handler as EventHandlers["emojiUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.GuildEmojiDelete, async (emoji) => {
    await deliver(state, emoji.guild, "emojiDelete", (handler, ctx) => (handler as EventHandlers["emojiDelete"])(emoji, ctx));
  });

  client.on(Events.ThreadUpdate, async (before, after) => {
    await deliver(state, after.guild, "threadUpdate", (handler, ctx) =>
      (handler as EventHandlers["threadUpdate"])(before, after, ctx),
    );
  });

  // A sticker's guild is only filled in when it is cached, so the server is looked up by id.
  const stickerGuild = (sticker: { guildId: string | null }): Guild | undefined =>
    sticker.guildId ? client.guilds.cache.get(sticker.guildId) : undefined;

  client.on(Events.GuildStickerCreate, async (sticker) => {
    const guild = stickerGuild(sticker);
    if (!guild) return;
    await deliver(state, guild, "stickerCreate", (handler, ctx) => (handler as EventHandlers["stickerCreate"])(sticker, ctx));
  });

  client.on(Events.GuildStickerUpdate, async (before, after) => {
    const guild = stickerGuild(after);
    if (!guild) return;
    await deliver(state, guild, "stickerUpdate", (handler, ctx) =>
      (handler as EventHandlers["stickerUpdate"])(before, after, ctx),
    );
  });

  client.on(Events.GuildStickerDelete, async (sticker) => {
    const guild = stickerGuild(sticker);
    if (!guild) return;
    await deliver(state, guild, "stickerDelete", (handler, ctx) => (handler as EventHandlers["stickerDelete"])(sticker, ctx));
  });

  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    await deliver(state, guild, "auditLogEntry", (handler, ctx) => (handler as EventHandlers["auditLogEntry"])(entry, ctx));
  });

  client.on(Events.GuildRoleCreate, async (role) => {
    await deliver(state, role.guild, "roleCreate", (handler, ctx) =>
      (handler as EventHandlers["roleCreate"])(role, ctx),
    );
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    await deliver(state, role.guild, "roleDelete", (handler, ctx) =>
      (handler as EventHandlers["roleDelete"])(role, ctx),
    );
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    await deliver(state, ban.guild, "banAdd", (handler, ctx) =>
      (handler as EventHandlers["banAdd"])(ban, ctx),
    );
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    await deliver(state, ban.guild, "banRemove", (handler, ctx) =>
      (handler as EventHandlers["banRemove"])(ban, ctx),
    );
  });

  registerComponentDispatch({ client, state });
}

/**
 * Routes buttons, select menus and modal submissions to the module that
 * created them, identified by the custom id they carry.
 */
function registerComponentDispatch({ client, state }: Deps): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    const isComponent = interaction.isMessageComponent();
    const isModal = interaction.isModalSubmit();
    if (!isComponent && !isModal) return;

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return;

    const module = state.moduleFor(parsed.moduleId);
    const handler = isComponent
      ? module?.components?.[parsed.action]
      : module?.modals?.[parsed.action];
    if (!module || !handler) return;

    const guild = interaction.guild ?? directMessageGuild(client, module.directMessage, parsed);
    if (!guild) return;

    if (!(await state.isEnabled(guild.id, module.id))) return;

    const ctx = await state.context(guild, module.id);
    if (!ctx) return;

    try {
      await (handler as (i: unknown, e: unknown) => Promise<void>)(interaction, {
        rest: parsed.rest,
        ctx,
      });
    } catch (error) {
      console.error(`[${module.id}] ${parsed.action} interaction failed:`, error);
      // Without an answer Discord tells the member "This interaction failed", which says nothing about what to do.
      if (interaction.isRepliable()) await replySystem(state, interaction, guild, "componentFailed");
    }
  });
}

/**
 * The server a button pressed in a direct message acts on, for an action the
 * module allows there. The id names the server first; one the bot is not in
 * gives nothing, so the press is ignored like any stale button.
 */
function directMessageGuild(client: Client, allowed: string[] | undefined, parsed: { action: string; rest: string }): Guild | null {
  if (!allowed?.includes(parsed.action)) return null;
  const guildId = parsed.rest.split(":")[0] ?? "";
  return client.guilds.cache.get(guildId) ?? null;
}
