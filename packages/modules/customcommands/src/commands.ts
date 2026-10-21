import { InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildBasedChannel, type GuildMember } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import { COMMAND_NAME, addOptions, admit, allowed, answerTo, runSteps, scopeFor, sentence, type Cause, type Ctx, type Option, type Runnable, type Step } from "@tier0/workflow";
import type { CustomCommand, CustomCommandSettings } from "./settings.js";

/**
 * The commands members of a server can use because its owner made them up. They
 * are registered in that server only and follow its settings as they change.
 */

/** A command that can be registered: switched on and properly named. */
export function isCommand(command: CustomCommand): boolean {
  return command.enabled && typeof command.command === "string" && COMMAND_NAME.test.test(command.command);
}

/** The reply, then whatever the owner added after it, as the steps a run carries out. */
export function runnableOf(command: CustomCommand): Runnable {
  const reply = { type: "message", where: "here", message: command.message } as Step;
  return { id: command.id, name: command.command, reply: command.reply as "private" | "public", steps: [reply, ...(command.steps as unknown as Step[])] };
}

function build(command: CustomCommand) {
  const made = new SlashCommandBuilder().setName(command.command).setDescription(command.description.slice(0, 100) || "Run this command").setContexts(InteractionContextType.Guild);
  addOptions(made, command.options as unknown as Option[]);
  return made;
}

async function run(interaction: ChatInputCommandInteraction, ctx: Ctx, wanted: string): Promise<void> {
  const settings = ctx.settings as CustomCommandSettings;
  const { messages } = settings;
  const command = settings.commands.find((entry) => entry.id === wanted);
  if (!command || !isCommand(command)) {
    await ctx.reply(interaction, messages.gone, {});
    return;
  }

  const found = interaction.member && "roles" in interaction.member && typeof (interaction.member as GuildMember).displayName === "string" ? (interaction.member as GuildMember) : null;
  const member = found ?? (await ctx.guild.members.fetch(interaction.user.id).catch(() => null));
  const channel = (interaction.channel as GuildBasedChannel | null) ?? null;
  const options: Record<string, string> = {};
  for (const option of command.options as unknown as Option[]) options[option.name] = answerTo(interaction, option);
  const cause: Cause = { member, user: interaction.user, channel, message: null, options };

  // Refusals are private and come first, before the command is answered in front of the channel.
  if (!allowed({ ...command, chance: 100 }, cause, true).ok) {
    await ctx.reply(interaction, messages.notAllowed, {});
    return;
  }
  const gate = admit(ctx.guild.id, command, interaction.user.id);
  if (!gate.ok) {
    if (gate.reason === "cooldown") await ctx.reply(interaction, messages.cooldown, { remaining: sentence(gate.left ?? 0) });
    else await ctx.reply(interaction, messages.failed, {});
    return;
  }

  await interaction.deferReply(command.reply === "public" ? {} : { flags: MessageFlags.Ephemeral });
  const runnable = runnableOf(command);
  const scope = { ...scopeFor(runnable, cause), interaction };
  await runSteps({ ctx, find: () => undefined }, runnable, scope);
  if (scope.problems.length > 0) await ctx.reply(interaction, messages.failed, {});
}

function definition(command: CustomCommand): CommandDefinition<CustomCommandSettings> {
  const id = command.id;
  return {
    name: command.command,
    description: command.description.slice(0, 100) || "Run this command",
    publicReply: command.reply === "public",
    build: () => build(command),
    run: (interaction, ctx) => run(interaction, ctx, id),
  };
}

/** Every command a server's settings make, one for each name. The first to use a name keeps it. */
export function commandsOf(settings: CustomCommandSettings): CommandDefinition<CustomCommandSettings>[] {
  const taken = new Set<string>();
  const made: CommandDefinition<CustomCommandSettings>[] = [];
  for (const command of settings.commands) {
    if (!isCommand(command) || taken.has(command.command)) continue;
    taken.add(command.command);
    made.push(definition(command));
  }
  return made;
}
