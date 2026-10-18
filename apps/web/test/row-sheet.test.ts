import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { fieldsForTab, pathInRow, rowCard, rowNotes, sheetTabs, tabMarks, tabOfPath } from "../lib/row-sheet.ts";

const colours = [
  { value: "primary", label: "Blurple", swatch: "#5865f2" },
  { value: "danger", label: "Red", swatch: "#da373c" },
];

/** A row shaped like a ticket type: top-level settings, and groups whose settings are spread over tabs. */
const row: Record<string, FieldDescriptor> = {
  name: { kind: "string", label: "Name", section: "basics" },
  emoji: { kind: "emoji", section: "basics" },
  handlers: { kind: "array", label: "Handlers", nudge: "No handlers yet", section: "people", of: { kind: "role" } },
  form: { kind: "array", label: "Questions", item: "question", section: "form", of: { kind: "object", fields: {} } },
  appearance: {
    kind: "object",
    label: "On the panel",
    section: "basics",
    fields: { style: { kind: "choice", options: colours, default: "primary" } },
  },
  opening: {
    kind: "object",
    label: "Where tickets open",
    tabLabels: { basics: "Where tickets open", people: "Who is told" },
    fields: {
      mode: {
        kind: "choice",
        options: [
          { value: "channel", label: "Private channel" },
          { value: "thread", label: "Private thread" },
        ],
        default: "channel",
        section: "basics",
      },
      category: { kind: "channel", label: "Category", essential: true, when: { field: "mode", equals: "channel", hide: true }, section: "basics" },
      observers: { kind: "array", of: { kind: "role" }, section: "people" },
    },
  },
  id: { kind: "string", generated: true },
};

describe("sheetTabs", () => {
  test("lists the tabs in the order their first setting appears, going into groups", () => {
    assert.deepEqual(
      sheetTabs(row).map((tab) => tab.id),
      ["basics", "people", "form"],
    );
  });

  test("labels a tab from its id", () => {
    assert.equal(sheetTabs({ a: { kind: "string", section: "autoClose" } })[0]?.label, "Auto close");
  });

  test("is empty when nothing names a tab", () => {
    assert.deepEqual(sheetTabs({ a: { kind: "string" } }), []);
  });

  test("a group's section is the default for what is inside it", () => {
    const tabs = sheetTabs({ group: { kind: "object", section: "rules", fields: { a: { kind: "string" }, b: { kind: "string", section: "other" } } } });
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      ["rules", "other"],
    );
  });
});

describe("fieldsForTab", () => {
  test("keeps what belongs in the tab and trims each group to what is in it", () => {
    const people = fieldsForTab(row, "people", "basics");
    assert.deepEqual(Object.keys(people), ["handlers", "opening"]);
    assert.deepEqual(Object.keys((people.opening?.fields ?? {}) as object), ["observers"]);
  });

  test("heads a group in each tab with its tabLabels entry, and falls back to its own label", () => {
    assert.equal(fieldsForTab(row, "people", "basics").opening?.label, "Who is told");
    assert.equal(fieldsForTab(row, "basics", "basics").opening?.label, "Where tickets open");
    assert.equal(fieldsForTab(row, "basics", "basics").appearance?.label, "On the panel");
  });

  test("leaves out a group with nothing in the tab", () => {
    assert.equal("appearance" in fieldsForTab(row, "form", "basics"), false);
  });

  test("puts a setting that names no tab in the first", () => {
    const loose = { a: { kind: "string" }, b: { kind: "string", section: "two" } } as Record<string, FieldDescriptor>;
    assert.deepEqual(Object.keys(fieldsForTab(loose, "one", "one")), ["a"]);
    assert.deepEqual(Object.keys(fieldsForTab(loose, "two", "one")), ["b"]);
  });
});

describe("tabOfPath", () => {
  test("finds the tab of a setting inside a group, ignoring list positions", () => {
    assert.equal(tabOfPath(row, "opening.category", "basics"), "basics");
    assert.equal(tabOfPath(row, "opening.observers[2]", "basics"), "people");
    assert.equal(tabOfPath(row, "form[0].label", "basics"), "form");
    assert.equal(tabOfPath(row, "handlers[1]", "basics"), "people");
  });

  test("a path it cannot place goes to the first tab", () => {
    assert.equal(tabOfPath(row, "nothing.here", "basics"), "basics");
    assert.equal(tabOfPath(row, "", "basics"), "basics");
  });
});

describe("rowNotes and tabMarks", () => {
  test("notes an empty setting that carries a nudge, and an empty essential one", () => {
    const notes = rowNotes(row, { name: "Support", opening: { mode: "channel" } }, "basics");
    assert.deepEqual(
      notes.map((note) => [note.path, note.tab, note.text]),
      [
        ["handlers", "people", "No handlers yet"],
        ["opening.category", "basics", "No category yet"],
      ],
    );
  });

  test("asks for nothing once the settings are filled, or while their condition is unmet", () => {
    assert.deepEqual(rowNotes(row, { handlers: ["1"], opening: { mode: "channel", category: "9" } }, "basics"), []);
    assert.deepEqual(rowNotes(row, { handlers: ["1"], opening: { mode: "thread" } }, "basics"), []);
  });

  test("reads a setting nobody saved as its default", () => {
    // The mode is not stored, so it is the default "channel" and the category is asked for.
    assert.equal(rowNotes(row, { handlers: ["1"], opening: {} }, "basics").length, 1);
  });

  test("marks a tab for a refusal, and a refusal outranks something merely missing", () => {
    const marks = tabMarks(row, { opening: { mode: "channel" } }, ["opening.category", "form[0].label"], "basics");
    assert.deepEqual(marks, { people: "needed", basics: "error", form: "error" });
  });

  test("marks nothing for a finished row", () => {
    assert.deepEqual(tabMarks(row, { handlers: ["1"], opening: { mode: "thread" } }, [], "basics"), {});
  });
});

describe("pathInRow", () => {
  test("strips the row's own path, and refuses another row's", () => {
    assert.equal(pathInRow("panels[0].types[1].opening.category", "panels[0].types[1]"), "opening.category");
    assert.equal(pathInRow("panels[0].types[10].name", "panels[0].types[1]"), null);
    assert.equal(pathInRow("panels[0].types[1]", "panels[0].types[1]"), "");
  });
});

describe("rowCard", () => {
  const labels = { role: (id: string) => (id === "r1" ? "@Support" : "unknown role") };
  const card = { emoji: "emoji", swatch: "appearance.style", chips: "handlers", facts: ["form", "opening.mode"] };

  test("reads the name, emoji, colour, handlers and facts from the row", () => {
    const view = rowCard(
      { name: "Support", emoji: "🎫", handlers: ["r1"], form: [{}], appearance: { style: "danger" }, opening: { mode: "thread" } },
      row,
      card,
      labels,
      "basics",
    );
    assert.equal(view.title, "Support");
    assert.equal(view.emoji, "🎫");
    assert.deepEqual(view.swatch, { color: "#da373c", label: "Red" });
    assert.deepEqual(view.chips, [{ id: "r1", label: "@Support" }]);
    assert.deepEqual(view.facts, ["1 question", "Private thread"]);
    assert.deepEqual(view.notes, []);
  });

  test("counts questions in the plural, and says none when there are none", () => {
    const two = rowCard({ name: "A", form: [{}, {}] }, row, card, labels, "basics");
    assert.equal(two.facts[0], "2 questions");
    const none = rowCard({ name: "A", form: [] }, row, card, labels, "basics");
    assert.equal(none.facts[0], "No questions");
  });

  test("falls back to the default colour and mode, and notes what is missing", () => {
    const view = rowCard({ name: "A" }, row, card, labels, "basics");
    assert.deepEqual(view.swatch, { color: "#5865f2", label: "Blurple" });
    assert.equal(view.facts.at(-1), "Private channel");
    assert.deepEqual(view.notes, ["No handlers yet", "No category yet"]);
    assert.deepEqual(view.chips, []);
  });

  test("has no title for a row with no filled text setting", () => {
    assert.equal(rowCard({}, row, card, labels, "basics").title, undefined);
  });
});
