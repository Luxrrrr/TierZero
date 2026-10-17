import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor, MessageAttachButtons, MessageAttachList } from "@tier0/core";
import {
  DEFAULT_MENU_TEXT,
  fixedButtons,
  getPath,
  listView,
  moveItem,
  readRef,
  setPath,
  writeRef,
} from "../lib/message-attach.ts";

const panelAttach: MessageAttachList = {
  kind: "list",
  list: "types",
  label: "appearance.buttonLabel",
  labelFallback: "name",
  emoji: "emoji",
  style: "appearance.buttonStyle",
  description: "appearance.description",
  mode: { field: "style", menu: "menu" },
  placeholder: "placeholder",
  noun: "ticket type",
};

const type = (name: string, look: Record<string, unknown> = {}, emoji?: string) => ({ name, emoji, appearance: look });

describe("buttons from the rows of a list", () => {
  test("each row is a button, its text falling back to the name", () => {
    const view = listView(panelAttach, {
      style: "buttons",
      types: [
        type("Game support", { buttonLabel: "Get help", buttonStyle: "success" }, "🎮"),
        type("Report a player", { buttonStyle: "danger" }),
        type("Ban appeal", { buttonLabel: "   ", buttonStyle: "rainbow" }),
      ],
    });
    assert.equal(view.mode, "buttons");
    assert.deepEqual(
      view.items.map((item) => [item.label, item.fallback, item.emoji, item.style]),
      [
        ["Get help", false, "🎮", "success"],
        ["Report a player", true, "", "danger"],
        ["Ban appeal", true, "", "primary"],
      ],
    );
  });

  test("buttons go five to a row, up to Discord's 25", () => {
    const types = Array.from({ length: 27 }, (_, i) => type(`Type ${i + 1}`));
    const view = listView(panelAttach, { types }, { kind: "array", max: 25 } as FieldDescriptor);
    assert.equal(view.items.length, 25);
    assert.deepEqual(view.rows.map((row) => row.length), [5, 5, 5, 5, 5]);
    assert.equal(view.full, true);
    assert.equal(view.max, 25);
    assert.deepEqual(listView(panelAttach, { types: types.slice(0, 7) }).rows.map((row) => row.length), [5, 2]);
  });

  test("a list's own smaller maximum is the limit", () => {
    const view = listView(panelAttach, { types: [type("A"), type("B")] }, { kind: "array", max: 2 } as FieldDescriptor);
    assert.equal(view.full, true);
    assert.equal(view.max, 2);
  });

  test("in menu mode the rows are options with their descriptions, under the placeholder", () => {
    const view = listView(panelAttach, {
      style: "menu",
      placeholder: "What do you need for the cup?",
      types: [type("Team registration", { description: "Sign a roster up" }, "🏆")],
    });
    assert.equal(view.mode, "menu");
    assert.equal(view.placeholder, "What do you need for the cup?");
    assert.deepEqual(view.items[0], { index: 0, label: "Team registration", fallback: true, emoji: "🏆", style: "primary", description: "Sign a roster up" });
  });

  test("an empty placeholder shows what Discord shows", () => {
    assert.equal(listView(panelAttach, { style: "menu", placeholder: "  ", types: [] }).placeholder, DEFAULT_MENU_TEXT);
  });

  test("rows move by one place and stay put at either end", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
  });
});

describe("buttons kept in other settings", () => {
  const attach: MessageAttachButtons = {
    kind: "buttons",
    buttons: [
      { name: "Close", label: "/labels.closeButton", style: "/labels.closeButtonStyle" },
      { name: "Claim", label: "/labels.claimButton", style: "/labels.claimButtonStyle", when: "rules.claim" },
    ],
  };
  const rootFields = {
    labels: {
      kind: "object",
      fields: {
        closeButton: { kind: "string", default: "Close ticket", max: 80 },
        closeButtonStyle: { kind: "choice", default: "danger" },
        claimButton: { kind: "string", default: "Claim", max: 80 },
        claimButtonStyle: { kind: "choice", default: "success" },
      },
    },
  } as unknown as Record<string, FieldDescriptor>;
  const siblingFields = { rules: { kind: "object", fields: { claim: { kind: "boolean", default: true } } } } as unknown as Record<string, FieldDescriptor>;

  test("read from the root, with each setting's default when the draft has none", () => {
    const buttons = fixedButtons(attach, {}, {}, siblingFields, rootFields);
    assert.deepEqual(
      buttons.map((button) => [button.name, button.label, button.style, button.max]),
      [
        ["Close", "Close ticket", "danger", 80],
        ["Claim", "Claim", "success", 80],
      ],
    );
  });

  test("follow the draft, and leave out a button whose switch is off", () => {
    const buttons = fixedButtons(
      attach,
      { rules: { claim: false } },
      { labels: { closeButton: "Done here", closeButtonStyle: "secondary" } },
      siblingFields,
      rootFields,
    );
    assert.deepEqual(buttons.map((button) => [button.label, button.style]), [["Done here", "secondary"]]);
  });

  test("an unknown colour falls back to the button's default", () => {
    const [close] = fixedButtons({ kind: "buttons", buttons: [{ name: "Close", label: "/labels.closeButton", defaultStyle: "danger" }] }, {}, {}, {}, rootFields);
    assert.equal(close?.style, "danger");
  });
});

describe("paths", () => {
  test("read and write by dotted path without touching the original", () => {
    const source = { a: { b: 1 }, c: 2 };
    assert.equal(getPath(source, "a.b"), 1);
    assert.equal(getPath(source, "a.x.y"), undefined);
    const next = setPath(source, "a.b", 5);
    assert.deepEqual(next, { a: { b: 5 }, c: 2 });
    assert.deepEqual(source, { a: { b: 1 }, c: 2 });
    assert.deepEqual(setPath({}, "x.y", "z"), { x: { y: "z" } });
    assert.deepEqual(setPath({ a: 1, b: 2 }, "a", undefined), { b: 2 });
  });

  test("a leading slash reads and writes from the settings root", () => {
    const siblings = { name: "Support" };
    const root = { labels: { closeButton: "Close ticket" } };
    assert.equal(readRef("/labels.closeButton", siblings, root), "Close ticket");
    assert.equal(readRef("name", siblings, root), "Support");
    assert.deepEqual(writeRef("/labels.closeButton", "Done", siblings, root), { scope: "root", next: { labels: { closeButton: "Done" } } });
    assert.deepEqual(writeRef("name", "Help", siblings, root), { scope: "siblings", next: { name: "Help" } });
  });
});
