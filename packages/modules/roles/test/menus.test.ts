import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GENERATED_ID } from "@tier0/core";
import { computeChange, legacyMenuId, menuSnapshot, upgradeMenus } from "../dist/menus.js";

const ROLES = ["r1", "r2", "r3"];

describe("legacyMenuId", () => {
  test("is the same for the same name every time, and a valid generated id", () => {
    assert.equal(legacyMenuId("Platforms"), legacyMenuId("Platforms"));
    assert.notEqual(legacyMenuId("Platforms"), legacyMenuId("Ranks"));
    assert.match(legacyMenuId("Platforms"), GENERATED_ID);
  });
});

describe("upgradeMenus", () => {
  test("gives a menu with no id the id worked out from its name", () => {
    const next = upgradeMenus({ menus: [{ name: "Platforms" }] }) as { menus: { id: string }[] };
    assert.equal(next.menus[0]?.id, legacyMenuId("Platforms"));
  });

  test("gives a second menu of the same name an id of its own", () => {
    const next = upgradeMenus({ menus: [{ name: "Pings" }, { name: "Pings" }] }) as { menus: { id: string }[] };
    const [first, second] = next.menus;
    assert.equal(first?.id, legacyMenuId("Pings"));
    assert.notEqual(second?.id, first?.id);
    assert.match(second?.id ?? "", GENERATED_ID);
  });

  test("leaves menus that have ids alone, and is idempotent", () => {
    const current = { menus: [{ name: "Pings", id: "abc12345" }] };
    assert.equal(upgradeMenus(current), current);
    const once = upgradeMenus({ menus: [{ name: "Pings" }, { name: "Ranks", id: "fixed" }] });
    assert.deepEqual(upgradeMenus(once), once);
  });

  test("does not take an id another menu already holds", () => {
    const taken = legacyMenuId("Pings");
    const next = upgradeMenus({ menus: [{ name: "Other", id: taken }, { name: "Pings" }] }) as { menus: { id: string }[] };
    assert.notEqual(next.menus[1]?.id, taken);
  });
});

describe("menuSnapshot", () => {
  const menu = { id: "a", name: "Pings", channel: "1", options: [{ role: "r1", label: "News" }] };

  test("is the same however the keys are ordered, and ignores the id", () => {
    const reordered = { options: [{ label: "News", role: "r1" }], channel: "1", name: "Pings", id: "b" };
    assert.equal(menuSnapshot(menu), menuSnapshot(reordered));
  });

  test("changes when anything members see changes", () => {
    assert.notEqual(menuSnapshot(menu), menuSnapshot({ ...menu, name: "Alerts" }));
    assert.notEqual(menuSnapshot(menu), menuSnapshot({ ...menu, options: [{ role: "r1", label: "Updates" }] }));
    assert.notEqual(menuSnapshot(menu), menuSnapshot({ ...menu, channel: "2" }));
  });
});

describe("computeChange", () => {
  const rules = (current: string[], extra: { exclusive?: boolean; maxPicks?: number } = {}) => ({
    current,
    menuRoles: ROLES,
    exclusive: extra.exclusive ?? false,
    ...(extra.maxPicks !== undefined ? { maxPicks: extra.maxPicks } : {}),
  });

  test("pressing an unselected role in a non-exclusive menu adds only it", () => {
    assert.deepEqual(computeChange(["r1"], rules([])), { ok: true, toAdd: ["r1"], toRemove: [] });
  });

  test("pressing an already-selected role removes it", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r1"])), { ok: true, toAdd: [], toRemove: ["r1"] });
  });

  test("a non-exclusive menu leaves other selections alone", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r2"])), { ok: true, toAdd: ["r1"], toRemove: [] });
  });

  test("an exclusive menu clears every other role the menu grants, and never one outside it", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r2", "outside"], { exclusive: true })), { ok: true, toAdd: ["r1"], toRemove: ["r2"] });
  });

  test("re-pressing the only selected role in an exclusive menu just removes it", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r1"], { exclusive: true })), { ok: true, toAdd: [], toRemove: ["r1"] });
  });

  test("several picks from a dropdown each switch their role", () => {
    assert.deepEqual(computeChange(["r1", "r2"], rules(["r2"])), { ok: true, toAdd: ["r1"], toRemove: ["r2"] });
  });

  test("a pick of a role the menu does not offer does nothing", () => {
    assert.deepEqual(computeChange(["elsewhere"], rules([])), { ok: true, toAdd: [], toRemove: [] });
  });

  test("a limit refuses a pick that would go over it, and allows one that stays inside it", () => {
    assert.deepEqual(computeChange(["r3"], rules(["r1", "r2"], { maxPicks: 2 })), { ok: false, reason: "tooMany", max: 2 });
    assert.deepEqual(computeChange(["r3", "r1"], rules(["r1", "r2"], { maxPicks: 2 })), { ok: true, toAdd: ["r3"], toRemove: ["r1"] });
    assert.deepEqual(computeChange(["r1"], rules(["r1", "r2", "r3"], { maxPicks: 2 })), { ok: true, toAdd: [], toRemove: ["r1"] });
  });
});
