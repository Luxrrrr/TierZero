import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { s } from "@tier0/core";
import { OPTION_NAME } from "./logic.js";
import { safe } from "./run.js";

/**
 * The things a member fills in when they use a command of the server's own: how
 * the owner sets them up, how they are added to the command, and how what was
 * typed is read back as the text a message shows.
 */

export const optionField = s.object({
  name: s.string({
    label: "Name",
    help: "What it is called when the member fills it in, and the {name} you use for it in your messages. Lowercase letters, numbers and _ only.",
    max: 32,
    pattern: OPTION_NAME,
  }),
  description: s.string({ label: "Question", help: "What the member is asked as they fill it in.", max: 100 }),
  kind: s.choice({
    label: "Kind of answer",
    options: [
      { value: "text", label: "Text" },
      { value: "number", label: "Number" },
      { value: "member", label: "A member" },
      { value: "channel", label: "A channel" },
      { value: "role", label: "A role" },
      { value: "yesno", label: "Yes or no" },
    ],
    default: "text",
  }),
  required: s.boolean({ label: "They must fill it in", default: true }),
});

export interface Option {
  name: string;
  description: string;
  kind: "text" | "number" | "member" | "channel" | "role" | "yesno";
  required: boolean;
}

/** Adds each option to a command. Discord wants the required ones first. */
export function addOptions(command: SlashCommandBuilder, options: readonly Option[]): void {
  const ordered = [...options].sort((a, b) => Number(b.required) - Number(a.required));
  for (const option of ordered) {
    const describe = <T extends { setName(name: string): T; setDescription(text: string): T; setRequired(required: boolean): T }>(made: T): T =>
      made.setName(option.name).setDescription(option.description.slice(0, 100) || option.name).setRequired(option.required);
    switch (option.kind) {
      case "number":
        command.addNumberOption(describe);
        break;
      case "member":
        command.addUserOption(describe);
        break;
      case "channel":
        command.addChannelOption(describe);
        break;
      case "role":
        command.addRoleOption(describe);
        break;
      case "yesno":
        command.addBooleanOption(describe);
        break;
      default:
        command.addStringOption((made) => describe(made).setMaxLength(1000));
    }
  }
}

/** What a member filled in, as the text a message shows. Text is made safe, since it can name anyone. */
export function answerTo(interaction: ChatInputCommandInteraction, option: Option): string {
  const name = option.name;
  switch (option.kind) {
    case "number":
      return String(interaction.options.getNumber(name) ?? "");
    case "member": {
      const user = interaction.options.getUser(name);
      return user ? `<@${user.id}>` : "";
    }
    case "channel": {
      const channel = interaction.options.getChannel(name);
      return channel ? `<#${channel.id}>` : "";
    }
    case "role": {
      const role = interaction.options.getRole(name);
      return role ? `<@&${role.id}>` : "";
    }
    case "yesno": {
      const answer = interaction.options.getBoolean(name);
      return answer === null ? "" : answer ? "yes" : "no";
    }
    default:
      return safe(interaction.options.getString(name) ?? "");
  }
}

/** How long a wait is, as a member reads it. */
export function sentence(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}
