import { Client, GatewayIntentBits, Partials, REST, Events } from "discord.js";
import { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import utility from "@tier0/module-utility";
import welcome from "@tier0/module-welcome";
import verification from "@tier0/module-verification";
import gaming from "@tier0/module-gaming";
import automations from "@tier0/module-automations";
import customcommands from "@tier0/module-customcommands";
import sticky from "@tier0/module-sticky";
import roles from "@tier0/module-roles";
import automod from "@tier0/module-automod";
import leveling from "@tier0/module-leveling";
import moderation, { backfillAutomodAudit, backfillEvidence, repairAutomodAudit } from "@tier0/module-moderation";
import serverlog from "@tier0/module-serverlog";
import tickets from "@tier0/module-tickets";
import auditlog from "@tier0/module-auditlog";
import feeds from "@tier0/module-feeds";
import system from "@tier0/module-system";
import { GuildState } from "./runtime/guild-state.js";
import { CommandSync } from "./runtime/commands.js";
import { registerEventDispatch } from "./runtime/dispatch.js";
import { Scheduler } from "./runtime/scheduler.js";
import { handleAutocomplete, handleCommand } from "./runtime/router.js";
import { registerMessageComponents } from "./runtime/message-components.js";
import { startControlApi } from "./control/server.js";
import { SCHEDULED_SEND, scheduledSendRunner } from "./control/message-schedules.js";
import { sendMessage } from "./control/messages.js";
import { systemLabels } from "./runtime/system-messages.js";
import { applyPresence, readPresence } from "./runtime/bot-profile.js";
import { syncInstanceOwner } from "./instance-owner.js";
import { config } from "./config.js";

const registry = new ModuleRegistry();
registry.register(utility);
registry.register(welcome);
registry.register(verification);
registry.register(gaming);
registry.register(roles);
registry.register(automations);
registry.register(customcommands);
registry.register(sticky);
registry.register(automod);
registry.register(leveling);
registry.register(moderation);
registry.register(serverlog);
registry.register(tickets);
registry.register(auditlog);
registry.register(feeds);
registry.register(system);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.MessageContent,
  ],
  // Without these, an event about something the bot never cached just gets
  // dropped, even though Discord still sends a little data for it. Audit
  // logging cares most about older messages, and those are never cached.
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction],
});

const state = new GuildState(client, registry);
const rest = new REST().setToken(config.token);
const commands = new CommandSync(rest, config.applicationId, registry, state);

const scheduler = new Scheduler(client, registry, state, {
  [SCHEDULED_SEND]: scheduledSendRunner(client, sendMessage, (guildId) => systemLabels(state, guildId)),
});

registerEventDispatch({ client, state });
registerMessageComponents(client, state);

client.once(Events.ClientReady, async (ready) => {
  console.log(`Connected as ${ready.user.tag}`);

  const recordOwner = () =>
    syncInstanceOwner(client).then(
      (ownerId) => !ownerId && console.warn("Could not read who owns the Discord application. Set INSTANCE_OWNER_ID in .env to name the owner."),
      async (error) => {
        console.error("Could not record the instance owner", error);
        // On the first start after an update the dashboard may not have changed the database yet, so one more try follows.
        setTimeout(() => void syncInstanceOwner(client).catch((again) => console.error("Could not record the instance owner", again)), 60_000);
      },
    );
  await recordOwner();

  // What the owner chose for the bot's status is kept in the database, so it comes back after a restart.
  applyPresence(client, await readPresence());

  for (const guild of ready.guilds.cache.values()) {
    await prisma.guild.upsert({
      where: { id: guild.id },
      create: { id: guild.id, name: guild.name },
      update: { name: guild.name },
    });
    await commands.run(guild.id);
  }

  // Old right-click cases only have a link to the message. Not awaited, since it fetches from Discord.
  void backfillEvidence(client).then(
    (count) => count > 0 && console.log(`Attached messages to ${count} older cases`),
    (error) => console.error("Could not attach messages to older cases", error),
  );

  void backfillAutomodAudit(client)
    .then((count) => count > 0 && console.log(`Added ${count} older automod cases to Staff activity`))
    .then(() => repairAutomodAudit(client))
    .then(
      (count) => count > 0 && console.log(`Rewrote ${count} older automod entries in Staff activity`),
      (error) => console.error("Could not update older automod entries in Staff activity", error),
    );

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
  if (interaction.isAutocomplete()) {
    await handleAutocomplete({ registry, state }, interaction);
    return;
  }
  if (!(interaction.isChatInputCommand() || interaction.isContextMenuCommand()) || !interaction.guild) return;
  await handleCommand({ registry, state }, interaction);
});

// A rejected promise nobody awaited is a bug in one task, not a reason to drop
// the gateway connection for every server, so it is logged and the bot carries on.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

// An uncaught exception leaves the process in a state nobody has checked, so
// it is logged and the bot exits for the container's restart policy to bring
// it back clean.
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  scheduler.stop();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

void client.login(config.token);
