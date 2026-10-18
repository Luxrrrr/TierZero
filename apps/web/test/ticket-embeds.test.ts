import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed } from "@tier0/core";
import { EMBED_BUDGET, embedLabel, embedProblems, embedsUsed } from "../lib/ticket-embeds.ts";

const embed = (over: Partial<ReturnType<typeof emptyEmbed>> = {}) => ({ ...emptyEmbed(), ...over });

describe("the embeds of a reply", () => {
  test("a chip is named for the first thing the embed says", () => {
    assert.equal(embedLabel(embed({ title: "Refund steps" }), 0), "Refund steps");
    assert.equal(embedLabel(embed({ description: "Open  Billing\nthen Refunds" }), 1), "Open Billing then Refunds");
    assert.equal(embedLabel(embed({ fields: [{ name: "Time", value: "2 days", inline: false }] }), 0), "Time");
    assert.equal(embedLabel(embed(), 2), "Embed 3");
    assert.equal(embedLabel(embed({ title: "x".repeat(80) }), 0).length, 48);
  });

  test("the budget counts what Discord counts, across embeds", () => {
    const one = embed({ title: "abc", description: "defg", fields: [{ name: "h", value: "ij", inline: false }] });
    assert.equal(embedsUsed([one, one]), 20);
    assert.equal(embedsUsed([]), 0);
  });

  test("an embed is checked on its own, with what the others use taken off", () => {
    assert.deepEqual(embedProblems(embed({ title: "Hi" }), []), []);
    assert.ok(embedProblems(embed(), []).length > 0, "an empty embed shows nothing");
    const wide = embed({ description: "a".repeat(4000) });
    const problems = embedProblems(wide, [embed({ description: "b".repeat(EMBED_BUDGET - 3000) })]);
    assert.ok(problems.some((problem) => /6,000|6000/.test(problem.message)));
  });

  test("a link that is a variable is a problem here, though the message builder allows it", () => {
    const problems = embedProblems(embed({ title: "Hi", imageUrl: "{server.icon}" }), []);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!.message, /web address/);
  });
});
