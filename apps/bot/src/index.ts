import { Client, GatewayIntentBits, MessageFlags, Partials, REST, Events } from "discord.js";
import { ModuleRegistry, type ReplyValues } from "@tier0/core";
import { prisma } from "@tier0/db";
import utility from "@tier0/module-utility";
import welcome from "@tier0/module-welcome";
import roles from "@tier0/module-roles";
import automod from "@tier0/module-automod";
import leveling from "@tier0/module-leveling";
import moderation, { backfillEvidence } from "@tier0/module-moderation";
import serverlog from "@tier0/module-serverlog";
import tickets from "@tier0/module-tickets";
import auditlog from "@tier0/module-auditlog";
import feeds from "@tier0/module-feeds";
import { GuildState } from "./runtime/guild-state.js";
import { CommandSync } from "./runtime/commands.js";
import { registerEventDispatch } from "./runtime/dispatch.js";
import { Scheduler } from "./runtime/scheduler.js";
import { checkCommandPolicy } from "./runtime/command-policy.js";
import { forceReplyVisibility } from "./runtime/reply-visibility.js";
import { buildReply } from "./runtime/command-reply.js";
import { commandVariables, stringValues } from "./runtime/command-variables.js";
import { registerMessageComponents, saveInteractions } from "./runtime/message-components.js";
import { hasInteractiveComponents } from "./control/message-payload.js";
import { startControlApi } from "./control/server.js";
import { config } from "./config.js";

const registry = new ModuleRegistry();
registry.register(utility);
registry.register(welcome);
registry.register(roles);
registry.register(automod);
registry.register(leveling);
registry.register(moderation);
registry.register(serverlog);
registry.register(tickets);
registry.register(auditlog);
registry.register(feeds);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.MessageContent,
  ],
  // Without these, an event about something the bot never cached just gets
  // dropped, even though Discord still sends a little data for it. Audit
  // logging cares most about older messages, and those are never cached.
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
});

const state = new GuildState(client, registry);
const rest = new REST().setToken(config.token);
const commands = new CommandSync(rest, config.applicationId, registry, state);

const scheduler = new Scheduler(client, registry, state);

registerEventDispatch({ client, state });
registerMessageComponents(client);

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

  // Old right-click cases only have a link to the message. Not awaited, since it fetches from Discord.
  void backfillEvidence(client).then(
    (count) => count > 0 && console.log(`Attached messages to ${count} older cases`),
    (error) => console.error("Could not attach messages to older cases", error),
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
  if (!(interaction.isChatInputCommand() || interaction.isContextMenuCommand()) || !interaction.guild) return;

  const moduleId = registry.ownerOf(interaction.commandName);
  if (!moduleId) return;

  if (!(await state.isEnabled(interaction.guild.id, moduleId))) {
    await interaction.reply({
      content: "That feature is switched off on this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const policy = await state.commandPolicy(interaction.guild.id, interaction.commandName);
  // Discord sends the member's roles with the interaction. They arrive as a
  // GuildMember when the guild is cached and as a plain id array when it is
  // not, and both forms have to be read the same way here.
  const member = interaction.member;
  const roleIds: string[] = !member
    ? []
    : Array.isArray(member.roles)
      ? member.roles
      : [...member.roles.cache.keys()];
  const verdict = checkCommandPolicy(policy, interaction.channelId, roleIds);
  if (!verdict.allowed) {
    await interaction.reply({
      content:
        verdict.reason === "channel"
          ? "That command is turned off in this channel."
          : "You do not have a role that is allowed to use that command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const module = registry.get(moduleId);
  const baseCtx = await state.context(interaction.guild, moduleId);
  if (!module || !baseCtx) return;
  // The reply the owner wrote, if any. A command asks for it with the values it
  // knows and falls back to its own wording when this says there is none.
  const owned = policy.customReply;
  let usedOwnedReply = false;
  const ctx =
    owned === null
      ? baseCtx
      : {
          ...baseCtx,
          customReply: (values: ReplyValues) => {
            const reply = buildReply(owned, { ...commandVariables(interaction), ...stringValues(values) }, interaction.guild ?? undefined);
            usedOwnedReply = usedOwnedReply || reply !== null;
            return reply;
          },
        };

  const restoreReply =
    policy.ephemeral === null ? null : forceReplyVisibility(interaction, policy.ephemeral);

  try {
    if (interaction.isContextMenuCommand()) {
      const entry = module.contextCommands?.find((c) => c.name === interaction.commandName);
      if (!entry) return;
      await entry.run(interaction, ctx);
    } else if (interaction.isChatInputCommand()) {
      const command = module.commands?.find((c) => c.name === interaction.commandName);
      if (!command) return;
      await command.run(interaction, ctx);
    }
    if (usedOwnedReply && owned !== null) {
      const interactive = hasInteractiveComponents(owned);
      // Reactions can only go on a reply everyone can see.
      const reactions = owned.reactions.length > 0 && !interaction.ephemeral;
      if (interactive || reactions) {
        const sent = await interaction.fetchReply().catch(() => null);
        if (sent && interactive) await saveInteractions(interaction.guild.id, interaction.channelId, sent.id, owned);
        if (reactions) for (const reaction of owned.reactions) await sent?.react(reaction).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(`${interaction.commandName} failed:`, error);
    // The failure notice is always private, whatever the owner chose for the command.
    restoreReply?.();
    const message = "That command did not finish. The server log has the details.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  }
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
