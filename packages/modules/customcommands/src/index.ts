import { defineModule, type TaskHandler } from "@tier0/core";
import { runSteps, thaw, warn } from "@tier0/workflow";
import { commandsOf, isCommand, runnableOf } from "./commands.js";
import { settingsSchema, type CustomCommandSettings } from "./settings.js";

/**
 * Slash commands an owner makes up: a name, what the member fills in, a reply
 * and a few simple steps after it. Each server has its own, registered through
 * `guildCommands`. Anything with branches or counters is an automation instead.
 */

const tasks: Record<string, TaskHandler<CustomCommandSettings>> = {
  /** Carries on with a command that was told to wait. One that was removed or switched off in the meantime stops. */
  async resume(payload, ctx) {
    const frozen = thaw(payload);
    if (!frozen) return;
    const command = ctx.settings.commands.find((entry) => entry.id === frozen.scope.workflowId);
    if (!command || !isCommand(command)) return;
    await runSteps({ ctx, find: () => undefined }, runnableOf(command), frozen.scope, frozen.from).catch(warn(`resume command ${command.id}`));
  },
};

export default defineModule({
  id: "customcommands",
  name: "Custom commands",
  summary: "Make up your own slash commands, with options the member fills in and a reply you write.",
  category: "utility",
  requires: ["ManageRoles", "ManageNicknames"],

  settings: settingsSchema,
  guildCommands: (settings) => commandsOf(settings),
  tasks,
});
