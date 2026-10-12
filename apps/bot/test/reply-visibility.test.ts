import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { forceReplyVisibility } from "../src/runtime/reply-visibility.ts";

function fake() {
  const calls: { method: string; options: Record<string, unknown> }[] = [];
  const interaction = {
    reply: async (options: Record<string, unknown>) => void calls.push({ method: "reply", options }),
    deferReply: async (options: Record<string, unknown>) =>
      void calls.push({ method: "deferReply", options }),
  };
  return { interaction, calls };
}

const EPHEMERAL = Number(MessageFlags.Ephemeral);

describe("forceReplyVisibility", () => {
  test("makes a public reply private", async () => {
    const { interaction, calls } = fake();
    forceReplyVisibility(interaction as never, true);
    await interaction.reply({ content: "hi" });
    assert.equal((calls[0]!.options.flags as number) & EPHEMERAL, EPHEMERAL);
  });

  test("makes a private reply public, including a plain string", async () => {
    const { interaction, calls } = fake();
    forceReplyVisibility(interaction as never, false);
    await (interaction.reply as (o: unknown) => Promise<void>)("hi");
    assert.equal(calls[0]!.options.content, "hi");
    assert.equal((calls[0]!.options.flags as number) & EPHEMERAL, 0);
  });

  test("applies to a deferred reply", async () => {
    const { interaction, calls } = fake();
    forceReplyVisibility(interaction as never, false);
    await interaction.deferReply({ flags: EPHEMERAL });
    assert.equal(calls[0]!.method, "deferReply");
    assert.equal((calls[0]!.options.flags as number) & EPHEMERAL, 0);
  });

  test("only changes the first response", async () => {
    const { interaction, calls } = fake();
    forceReplyVisibility(interaction as never, false);
    await interaction.reply({ content: "one" });
    await interaction.reply({ content: "two", flags: EPHEMERAL });
    assert.equal(calls[1]!.options.flags, EPHEMERAL);
  });

  test("restore puts the original back before anything was sent", async () => {
    const { interaction, calls } = fake();
    const restore = forceReplyVisibility(interaction as never, false);
    restore();
    await interaction.reply({ content: "error", flags: EPHEMERAL });
    assert.equal(calls[0]!.options.flags, EPHEMERAL);
  });
});
