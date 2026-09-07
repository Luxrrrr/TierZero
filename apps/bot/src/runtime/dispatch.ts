import { Events, type Client } from "discord.js";
import type { GuildState } from "./guild-state.js";

interface Deps {
  client: Client;
  state: GuildState;
}

/**
 * Wires the three event handlers a module can declare. Every enabled module
 * with a handler for the event gets its own try/catch, so one module's bug
 * cannot stop delivery to the others or crash the gateway connection.
 */
export function registerEventDispatch({ client, state }: Deps): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const guild = message.guild;

    for (const module of await state.enabledModules(guild.id)) {
      const handler = module.events?.messageCreate;
      if (!handler) continue;

      const ctx = await state.context(guild, module.id);
      if (!ctx) continue;

      try {
        await handler(message, ctx);
      } catch (error) {
        console.error(`[${module.id}] messageCreate handler failed:`, error);
      }
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const guild = member.guild;

    for (const module of await state.enabledModules(guild.id)) {
      const handler = module.events?.memberJoin;
      if (!handler) continue;

      const ctx = await state.context(guild, module.id);
      if (!ctx) continue;

      try {
        await handler(member, ctx);
      } catch (error) {
        console.error(`[${module.id}] memberJoin handler failed:`, error);
      }
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const guild = member.guild;

    for (const module of await state.enabledModules(guild.id)) {
      const handler = module.events?.memberLeave;
      if (!handler) continue;

      const ctx = await state.context(guild, module.id);
      if (!ctx) continue;

      try {
        await handler(member, ctx);
      } catch (error) {
        console.error(`[${module.id}] memberLeave handler failed:`, error);
      }
    }
  });
}
