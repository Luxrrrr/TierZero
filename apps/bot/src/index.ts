import { Client, GatewayIntentBits, MessageFlags, REST, Events } from "discord.js";
import { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import utility from "@tier0/module-utility";
import { GuildState } from "./runtime/guild-state.js";
import { CommandSync } from "./runtime/commands.js";
import { registerEventDispatch } from "./runtime/dispatch.js";
import { Scheduler } from "./runtime/scheduler.js";
import { startControlApi } from "./control/server.js";
import { config } from "./config.js";

const registry = new ModuleRegistry();
registry.register(utility);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const state = new GuildState(client, registry);
const rest = new REST().setToken(config.token);
const commands = new CommandSync(rest, config.applicationId, registry, state);

const scheduler = new Scheduler(client, registry, state);

registerEventDispatch({ client, state });

client.once(Events.ClientReady, async (ready) => {
  console.log(`Connected as ${ready.user.tag}`);

  for (const guild of ready.guilds.cache.values()) {
    await prisma.guild.upsert({
      where: { id: guild.id },
      create: { id: guild.id, name: guild.name },
      update: { name: guild.name },
    });
    await commands.run(guild.id);
  }

  scheduler.start();
  startControlApi({ client, registry, state, commands });
});

client.on(Events.GuildCreate, async (guild) => {
  await prisma.guild.upsert({
    where: { id: guild.id },
    create: { id: guild.id, name: guild.name },
    update: { name: guild.name },
  });
  await commands.run(guild.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const moduleId = registry.ownerOf(interaction.commandName);
  if (!moduleId) return;

  if (!(await state.isEnabled(interaction.guild.id, moduleId))) {
    await interaction.reply({
      content: "That feature is switched off on this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const module = registry.get(moduleId);
  const command = module?.commands?.find((c) => c.name === interaction.commandName);
  const ctx = await state.context(interaction.guild, moduleId);
  if (!command || !ctx) return;

  try {
    await command.run(interaction, ctx);
  } catch (error) {
    console.error(`/${interaction.commandName} failed:`, error);
    const message = "That command did not finish. The server log has the details.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  }
});

process.on("SIGTERM", async () => {
  scheduler.stop();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

void client.login(config.token);
