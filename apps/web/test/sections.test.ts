import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SECTIONS,
  groupModulesBySection,
  hasSettings,
  navGroups,
  orderModulesBySection,
  sectionCounts,
  sectionHeading,
} from "../lib/sections.ts";

const modules = [
  { id: "auditlog", category: "logging" as const },
  { id: "automod", category: "moderation" as const },
  { id: "moderation", category: "moderation" as const },
  { id: "welcome", category: "members" as const },
];

describe("groupModulesBySection", () => {
  test("returns every category, in sidebar order", () => {
    const groups = groupModulesBySection(modules);
    assert.deepEqual(
      groups.map((group) => group.id),
      SECTIONS.map((section) => section.id),
    );
  });

  test("files each module under its own category", () => {
    const groups = groupModulesBySection(modules);
    const moderation = groups.find((group) => group.id === "moderation");
    assert.deepEqual(moderation?.modules.map((module) => module.id), ["automod", "moderation"]);
  });

  test("keeps the order modules arrived in within a category", () => {
    const reversed = groupModulesBySection([...modules].reverse());
    const moderation = reversed.find((group) => group.id === "moderation");
    assert.deepEqual(moderation?.modules.map((module) => module.id), ["moderation", "automod"]);
  });

  test("leaves a category with no modules empty rather than dropping it", () => {
    const groups = groupModulesBySection(modules);
    const engagement = groups.find((group) => group.id === "engagement");
    assert.deepEqual(engagement?.modules, []);
    assert.equal(typeof engagement?.heading, "string");
  });

  test("carries each category's heading and description through", () => {
    const groups = groupModulesBySection([]);
    for (const section of SECTIONS) {
      const group = groups.find((entry) => entry.id === section.id);
      assert.equal(group?.heading, section.heading);
      assert.equal(group?.description, section.description);
    }
  });

  test("groups nothing when no module is registered", () => {
    const groups = groupModulesBySection([]);
    assert.equal(groups.length, SECTIONS.length);
    assert.equal(
      groups.every((group) => group.modules.length === 0),
      true,
    );
  });
});

describe("the More section", () => {
  test("comes last, after every main category", () => {
    assert.equal(SECTIONS[SECTIONS.length - 1]?.id, "more");
  });

  test("holds the log channel, apart from the Logging section", () => {
    const groups = navGroups([{ id: "auditlog", category: "more" as const, area: null }, { id: "feeds", category: "logging" as const, area: null }]);
    assert.deepEqual(groups.map((group) => group.id), ["logging", "more"]);
  });
});

describe("navGroups", () => {
  const withAreas = [
    { id: "automod", category: "moderation" as const, area: "moderation" as const },
    { id: "moderation", category: "moderation" as const, area: "moderation" as const },
    { id: "welcome", category: "members" as const, area: null },
    { id: "auditlog", category: "logging" as const },
  ];

  test("leaves out modules an area hosts, and the group they emptied", () => {
    const groups = navGroups(withAreas);
    assert.deepEqual(
      groups.map((group) => group.id),
      ["members", "logging"],
    );
  });

  test("keeps a category that still has an ungrouped module", () => {
    const groups = navGroups([...withAreas, { id: "extra", category: "moderation" as const, area: null }]);
    assert.deepEqual(groups[0]?.modules.map((module) => module.id), ["extra"]);
  });

  test("renders no groups at all for no modules", () => {
    assert.deepEqual(navGroups([]), []);
  });

  test("leaves out the bot's own always-on settings, which are reached from Bot messages", () => {
    const groups = navGroups([
      { id: "system", category: "more" as const, area: null, alwaysOn: true },
      { id: "feeds", category: "logging" as const, area: null, alwaysOn: false },
    ]);
    assert.deepEqual(groups.map((group) => group.id), ["logging"]);
  });
});

describe("orderModulesBySection", () => {
  test("orders by category first, then by arrival order", () => {
    const ordered = orderModulesBySection(modules);
    assert.deepEqual(
      ordered.map((module) => module.id),
      ["automod", "moderation", "welcome", "auditlog"],
    );
  });

  test("returns nothing for no modules", () => {
    assert.deepEqual(orderModulesBySection([]), []);
  });
});

describe("sectionCounts", () => {
  test("lists only populated categories, in sidebar order, with counts", () => {
    assert.deepEqual(sectionCounts(modules), [
      { id: "moderation", heading: "Moderation", count: 2 },
      { id: "members", heading: "Members", count: 1 },
      { id: "logging", heading: "Logging", count: 1 },
    ]);
  });
});

describe("sectionHeading", () => {
  test("looks up a category's heading", () => {
    assert.equal(sectionHeading("support"), "Support");
  });
});

describe("features with nothing to configure", () => {
  const empty = { type: "object", fields: {} };
  const some = { type: "object", fields: { channel: { kind: "channel" } } };

  test("are told apart from ones with settings", () => {
    assert.equal(hasSettings({ schema: empty }), false);
    assert.equal(hasSettings({ schema: some }), true);
    assert.equal(hasSettings({}), true);
  });

  test("get no sidebar page, and the section they leave empty has no heading", () => {
    const groups = navGroups([
      { id: "utility", category: "utility" as const, area: null, schema: empty },
      { id: "welcome", category: "members" as const, area: null, schema: some },
    ]);
    assert.deepEqual(groups.map((group) => group.id), ["members"]);
  });
});
