import { Events, type Client, type Guild } from "discord.js";
import type { EventHandlers, ModuleContext } from "@tier0/core";
import { parseCustomId } from "@tier0/core";
import type { GuildState } from "./guild-state.js";

interface Deps {
  client: Client;
  state: GuildState;
}

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
  for (const module of await state.enabledModules(guild.id)) {
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
    if (message.author.bot || !message.guild) return;
    const guild = message.guild;
    await deliver(state, guild, "messageCreate", (handler, ctx) =>
      (handler as EventHandlers["messageCreate"])(message, ctx),
    );
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;
    const guild = message.guild;
    await deliver(state, guild, "messageDelete", (handler, ctx) =>
      (handler as EventHandlers["messageDelete"])(message, ctx),
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
    if ((!isComponent && !isModal) || !interaction.guild) return;

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return;

    const module = state.moduleFor(parsed.moduleId);
    const handler = isComponent
      ? module?.components?.[parsed.action]
      : module?.modals?.[parsed.action];
    if (!module || !handler) return;

    if (!(await state.isEnabled(interaction.guild.id, module.id))) return;

    const ctx = await state.context(interaction.guild, module.id);
    if (!ctx) return;

    try {
      await (handler as (i: unknown, e: unknown) => Promise<void>)(interaction, {
        rest: parsed.rest,
        ctx,
      });
    } catch (error) {
      console.error(`[${module.id}] ${parsed.action} interaction failed:`, error);
    }
  });
}
