import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  collapsibleRuns,
  groupOfPath,
  groupsWithErrors,
  hashTarget,
  needsAttention,
  opensOnEnable,
  runIsOpen,
  toggled,
  toggleRun,
  withOpen,
} from "../lib/group-open.ts";

const KEYS = ["invites", "links", "capitals"];

describe("groupOfPath", () => {
  test("takes the first segment of a dotted or indexed path", () => {
    assert.equal(groupOfPath("invites.actions"), "invites");
    assert.equal(groupOfPath("menus[2].name"), "menus");
    assert.equal(groupOfPath("exemptRoles"), "exemptRoles");
  });
});

describe("groupsWithErrors", () => {
  test("names each group that holds an error once, in page order", () => {
    const errors = { "capitals.minLength": "x", "invites.actions": "y", "invites.exemptRoles[0]": "z" };
    assert.deepEqual(groupsWithErrors(errors, KEYS), ["invites", "capitals"]);
  });

  test("ignores errors outside the collapsible groups", () => {
    assert.deepEqual(groupsWithErrors({ logChannel: "bad" }, KEYS), []);
  });
});

describe("hashTarget", () => {
  test("matches the group key or the section id", () => {
    assert.equal(hashTarget("#links", KEYS), "links");
    assert.equal(hashTarget("#group-capitals", KEYS), "capitals");
  });

  test("matches nothing for an empty or unknown hash", () => {
    assert.equal(hashTarget("", KEYS), undefined);
    assert.equal(hashTarget("#", KEYS), undefined);
    assert.equal(hashTarget("#elsewhere", KEYS), undefined);
  });
});

describe("open state", () => {
  test("withOpen adds without touching the original", () => {
    const before = new Set(["links"]);
    const after = withOpen(before, ["invites"]);
    assert.deepEqual([...after].sort(), ["invites", "links"]);
    assert.equal(before.size, 1);
  });

  test("toggled flips one group", () => {
    assert.deepEqual([...toggled(new Set(), "links")], ["links"]);
    assert.deepEqual([...toggled(new Set(["links"]), "links")], []);
  });
});

describe("collapsibleRuns", () => {
  const item = (key: string, collapsible: boolean) => ({ key, collapsible });

  test("finds runs of two or more side by side", () => {
    const runs = collapsibleRuns([
      item("general", false),
      item("a", true),
      item("b", true),
      item("plain", false),
      item("c", true),
      item("d", true),
      item("e", true),
    ]);
    assert.deepEqual(runs, [
      ["a", "b"],
      ["c", "d", "e"],
    ]);
  });

  test("a lone collapsible group gets no control", () => {
    assert.deepEqual(collapsibleRuns([item("a", true), item("b", false)]), []);
  });
});

describe("expand and collapse all", () => {
  const run = ["a", "b", "c"];

  test("opens the whole run when any of it is closed", () => {
    const next = toggleRun(new Set(["a"]), run);
    assert.equal(runIsOpen(next, run), true);
  });

  test("closes the whole run once all of it is open", () => {
    const next = toggleRun(new Set(["a", "b", "c", "other"]), run);
    assert.deepEqual([...next], ["other"]);
  });

  test("an empty run is never open", () => {
    assert.equal(runIsOpen(new Set(), []), false);
  });
});

describe("needsAttention", () => {
  const fields = {
    enabled: { kind: "boolean" },
    actions: { kind: "array", min: 1 },
    words: { kind: "array" },
    channel: { kind: "channel", essential: true },
  };

  test("is true for a required list that is empty", () => {
    assert.equal(needsAttention({ actions: fields.actions }, { actions: [] }), true);
  });

  test("falls back to the default before counting a list as empty", () => {
    assert.equal(needsAttention({ actions: { ...fields.actions, default: ["delete"] } }, {}), false);
  });

  test("is true for an essential setting that is blank", () => {
    assert.equal(needsAttention({ channel: fields.channel }, { channel: "" }), true);
    assert.equal(needsAttention({ channel: fields.channel }, { channel: "123" }), false);
  });

  test("ignores optional lists and switches", () => {
    assert.equal(needsAttention({ enabled: fields.enabled, words: fields.words }, {}), false);
  });
});

describe("opensOnEnable", () => {
  const fields = { actions: { kind: "array", min: 1 } };

  test("opens when switched on with a required choice unset", () => {
    assert.equal(opensOnEnable(true, fields, { actions: [] }), true);
  });

  test("never opens when switched off", () => {
    assert.equal(opensOnEnable(false, fields, { actions: [] }), false);
  });

  test("stays closed when nothing is missing", () => {
    assert.equal(opensOnEnable(true, fields, { actions: ["delete"] }), false);
  });
});
