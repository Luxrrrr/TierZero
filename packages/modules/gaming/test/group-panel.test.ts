import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { panelRows } from "../dist/group-panel.js";

const option = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `o${n}`,
  label: `Option ${n}`,
  style: "secondary",
  privacy: "open",
  userLimit: 0,
  name: "{user}'s group",
  ...extra,
});

const panel = (count: number) => ({ id: "p1", name: "Hub", options: Array.from({ length: count }, (_, i) => option(i + 1)) }) as never;

describe("panelRows", () => {
  test("puts a button in for each option, carrying the panel and the option", () => {
    const rows = panelRows(panel(2));
    assert.equal(rows.length, 1);
    const buttons = rows[0]!.toJSON().components as unknown as { custom_id: string; label: string }[];
    assert.deepEqual(buttons.map((b) => b.label), ["Option 1", "Option 2"]);
    assert.ok(buttons[0]!.custom_id.endsWith("p1:o1"));
  });

  test("starts a new row after five buttons", () => {
    const rows = panelRows(panel(7));
    assert.deepEqual(rows.map((r) => r.components.length), [5, 2]);
  });

  test("fits the fifteen options a panel may hold in three rows", () => {
    assert.equal(panelRows(panel(15)).length, 3);
  });

  test("keeps the emoji and colour of an option", () => {
    const rows = panelRows({ id: "p1", name: "Hub", options: [option(1, { emoji: "🎮", style: "success" })] } as never);
    const [button] = rows[0]!.toJSON().components as unknown as { emoji?: { name: string }; style: number }[];
    assert.equal(button!.emoji?.name, "🎮");
    assert.equal(button!.style, 3);
  });
});
