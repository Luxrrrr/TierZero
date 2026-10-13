import { MessageFlags } from "discord.js";
import type { ModuleContext, ReplyValues, ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { repliable, type Answerable } from "../reply.js";

/**
 * Answers a command with the reply the owner wrote for it on the Commands page,
 * or else with that reply's starting wording, which is what the command said
 * before it could be changed. The starting body is the only copy of that text.
 */
export async function answer(
  interaction: Answerable,
  ctx: ModuleContext<ModerationSettings>,
  response: ResponseTemplate,
  values: ReplyValues,
): Promise<void> {
  const target = repliable(interaction);
  const custom = ctx.customReply?.(values);
  if (custom) {
    await target.reply({ ...custom, flags: MessageFlags.Ephemeral });
    return;
  }
  await ctx.reply(target, response.starting, values);
}
