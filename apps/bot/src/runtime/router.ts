import type { AutocompleteInteraction, ChatInputCommandInteraction, ContextMenuCommandInteraction } from "discord.js";
import { subcommandKey, type ModuleRegistry, type ReplyValues } from "@tier0/core";
import { checkCommandPolicy } from "./command-policy.js";
import { forceReplyVisibility } from "./reply-visibility.js";
import { buildReply } from "./command-reply.js";
import { commandVariables, stringValues } from "./command-variables.js";
import { saveInteractions } from "./message-components.js";
import { hasInteractiveComponents } from "../control/message-payload.js";
import type { GuildState } from "./guild-state.js";
import { replySystem } from "./system-messages.js";

/** What the router needs from the guild state, so a test can stand in for it. */
export type RouterState = Pick<GuildState, "isEnabled" | "commandPolicy" | "context" | "systemSettings">;

export type CommandInteraction = ChatInputCommandInteraction | ContextMenuCommandInteraction;

/** A command as members type it: with its slash, or the name of a right-click entry as it is. */
export function commandLabel(interaction: CommandInteraction): string {
  return interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.commandName;
}

/**
 * The part of a slash command that was used, as its override is stored
 * (`ticket close`), or null for a command without parts and for a right-click entry.
 */
export function subcommandUsed(interaction: CommandInteraction): string | null {
  if (!interaction.isChatInputCommand()) return null;
  const options = interaction.options as Partial<Pick<ChatInputCommandInteraction["options"], "getSubcommand" | "getSubcommandGroup">> | undefined;
  const subcommand = options?.getSubcommand?.(false) ?? null;
  if (!subcommand) return null;
  return subcommandKey(interaction.commandName, options?.getSubcommandGroup?.(false) ?? null, subcommand);
}

type Verdict = { ok: true } | { ok: false; refuse: () => Promise<unknown> };

/**
 * Checks one set of rules: the whole command's, or one part's. Discord shows
 * every part of a command to anyone who can see the command, so a part that
 * is off or limited is refused here, with the same messages as a whole command.
 */
async function checkRules(
  state: RouterState,
  interaction: CommandInteraction,
  guild: NonNullable<CommandInteraction["guild"]>,
  key: string,
  command: string,
  roleIds: string[],
): Promise<Verdict> {
  const policy = await state.commandPolicy(guild.id, key);
  if (policy.enabled === false) {
    return { ok: false, refuse: () => replySystem(state, interaction, guild, "commandOff", { command }) };
  }
  const verdict = checkCommandPolicy(policy, interaction.channelId, roleIds, parentsOf(interaction));
  if (verdict.allowed) return { ok: true };
  if (verdict.reason === "channel") return { ok: false, refuse: () => replySystem(state, interaction, guild, "channelOff", { command }) };
  return {
    ok: false,
    refuse: () =>
      replySystem(state, interaction, guild, "noRole", {
        command,
        roles: policy.allowRoles.map((id) => `<@&${id}>`).join(", "),
      }),
  };
}

/**
 * Runs one command or right-click entry: checks that its feature is on and that
 * its role and channel rules allow it, then hands it the context it asked for.
 * Every refusal and failure the member sees is one of the bot's own messages,
 * which the owner can reword.
 */
export async function handleCommand(
  { registry, state }: { registry: ModuleRegistry; state: RouterState },
  interaction: CommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const moduleId = registry.ownerOf(interaction.commandName);
  if (!moduleId) return;

  const command = commandLabel(interaction);

  if (!(await state.isEnabled(guild.id, moduleId))) {
    await replySystem(state, interaction, guild, "featureOff", {
      command,
      module: registry.get(moduleId)?.name ?? moduleId,
    });
    return;
  }

  // Discord sends the member's roles with the interaction. They arrive as a
  // GuildMember when the guild is cached and as a plain id array when it is
  // not, and both forms have to be read the same way here.
  const member = interaction.member;
  const roleIds: string[] = !member
    ? []
    : Array.isArray(member.roles)
      ? member.roles
      : [...member.roles.cache.keys()];
  const policy = await state.commandPolicy(guild.id, interaction.commandName);
  const whole = await checkRules(state, interaction, guild, interaction.commandName, command, roleIds);
  if (!whole.ok) {
    await whole.refuse();
    return;
  }
  const part = subcommandUsed(interaction);
  if (part !== null) {
    const own = await checkRules(state, interaction, guild, part, `/${part}`, roleIds);
    if (!own.ok) {
      await own.refuse();
      return;
    }
  }

  const module = registry.get(moduleId);
  const baseCtx = await state.context(guild, moduleId);
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
            const reply = buildReply(owned, { ...commandVariables(interaction), ...stringValues(values) }, guild);
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
      const entry = module.commands?.find((c) => c.name === interaction.commandName);
      if (!entry) return;
      await entry.run(interaction, ctx);
    }
    if (usedOwnedReply && owned !== null) {
      const interactive = hasInteractiveComponents(owned);
      // Reactions can only go on a reply everyone can see.
      const reactions = owned.reactions.length > 0 && !interaction.ephemeral;
      if (interactive || reactions) {
        const sent = await interaction.fetchReply().catch(() => null);
        if (sent && interactive) await saveInteractions(guild.id, interaction.channelId, sent.id, owned);
        if (reactions) for (const reaction of owned.reactions) await sent?.react(reaction).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(`${interaction.commandName} failed:`, error);
    // The failure notice is always private, whatever the owner chose for the command.
    restoreReply?.();
    await replySystem(state, interaction, guild, "commandFailed", { command });
  }
}

/** The channel a thread sits in and the category above, so a rule on either reaches the command. */
export function parentsOf(interaction: Pick<CommandInteraction, "channel" | "guild">): string[] {
  const parents: string[] = [];
  let parentId = interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null;
  // A thread's parent is a channel, which may itself sit in a category: two steps at most.
  for (let step = 0; step < 2 && parentId; step += 1) {
    parents.push(parentId);
    const parent = interaction.guild?.channels.cache.get(parentId);
    parentId = parent && "parentId" in parent ? parent.parentId : null;
  }
  return parents;
}

/**
 * Answers Discord's request for an option's suggestions. A feature that is off,
 * or a command without suggestions, gets an empty list so the member's client
 * stops waiting.
 */
export async function handleAutocomplete(
  { registry, state }: { registry: ModuleRegistry; state: Pick<RouterState, "isEnabled" | "context"> },
  interaction: AutocompleteInteraction,
): Promise<void> {
  const guild = interaction.guild;
  const moduleId = registry.ownerOf(interaction.commandName);
  const entry = moduleId ? registry.get(moduleId)?.commands?.find((c) => c.name === interaction.commandName) : undefined;
  const ctx = guild && moduleId && entry?.autocomplete && (await state.isEnabled(guild.id, moduleId)) ? await state.context(guild, moduleId) : null;
  try {
    if (ctx && entry?.autocomplete) await entry.autocomplete(interaction, ctx);
    else await interaction.respond([]);
  } catch (error) {
    console.error(`${interaction.commandName} suggestions failed:`, error);
    if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
  }
}
