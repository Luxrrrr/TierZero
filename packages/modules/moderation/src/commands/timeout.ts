import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { embedReply, type CommandDefinition, type ModuleContext, type ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { parseDuration } from "../duration.js";
import { say } from "../reply.js";
import { answer } from "./answer.js";
import { runFromCommand } from "./run-action.js";

type Ctx = ModuleContext<ModerationSettings>;

const TIMEOUT_REPLY: ResponseTemplate = {
  starting: embedReply("Timed out {user} until {until}. Case #{case}.", "success"),
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "until", description: "When the timeout ends, as a Discord date", sample: "Oct 18, 4:12 PM" },
    { name: "case", description: "The case number", sample: "118" },
  ],
  note: "Used when a timeout is set. Lifting one is Replies and errors, in the Moderation settings.",
};

async function runSet(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const target = interaction.options.getUser("member", true);
  const durationInput = interaction.options.getString("duration");
  const durationMs =
    durationInput === null ? ctx.settings.defaultTimeoutDuration : parseDuration(durationInput);

  const record = await runFromCommand(interaction, ctx, {
    action: "timeout",
    target,
    durationMs,
    unreadableDuration: durationMs === null,
  });
  if (!record) return;

  const until = `<t:${Math.floor(record.expiresAt!.getTime() / 1000)}:f>`;
  await answer(interaction, ctx, TIMEOUT_REPLY, { user: target.username, until, case: record.caseNumber });
}

async function runClear(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const target = interaction.options.getUser("member", true);
  const record = await runFromCommand(interaction, ctx, { action: "timeout-clear", target });
  if (!record) return;

  await say(ctx, interaction, "confirmations", "timeoutCleared", { user: target.username, case: record.caseNumber });
}

export const timeoutCommand: CommandDefinition<ModerationSettings> = {
  name: "timeout",
  response: TIMEOUT_REPLY,
  description: "Time a member out, or lift an existing timeout.",
  build: () =>
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time a member out, or lift an existing timeout.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Time a member out.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to time out").setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("How long, e.g. 10m, 2h, 7d. Defaults to the server's setting."),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("clear")
          .setDescription("Lift a member's timeout.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to clear").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      ),
  async run(interaction, ctx) {
    const sub = interaction.options.getSubcommand(true);
    if (sub === "set") {
      await runSet(interaction, ctx);
    } else {
      await runClear(interaction, ctx);
    }
  },
};
