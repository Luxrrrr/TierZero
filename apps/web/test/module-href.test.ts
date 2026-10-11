import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { areaModule, areaModules, isHosted, moduleHref } from "../lib/module-href.ts";

const modules = [
  { id: "automod", area: "moderation" as const },
  { id: "welcome", area: null },
  { id: "moderation", area: "moderation" as const },
  { id: "utility" },
];

describe("moduleHref", () => {
  test("a module without an area keeps its own page", () => {
    assert.equal(moduleHref("1", { id: "welcome", area: null }), "/guilds/1/welcome");
    assert.equal(moduleHref("1", { id: "utility" }), "/guilds/1/utility");
  });

  test("the primary module of an area sits at the settings root", () => {
    assert.equal(moduleHref("1", { id: "moderation", area: "moderation" }), "/guilds/1/mod/settings");
  });

  test("any other hosted module sits one segment below it", () => {
    assert.equal(moduleHref("42", { id: "automod", area: "moderation" }), "/guilds/42/mod/settings/automod");
  });
});

describe("isHosted", () => {
  test("is true only when an area is set", () => {
    assert.equal(isHosted({ id: "a", area: "moderation" }), true);
    assert.equal(isHosted({ id: "a", area: null }), false);
    assert.equal(isHosted({ id: "a" }), false);
  });
});

describe("areaModules", () => {
  test("lists the hosted modules with the primary first", () => {
    assert.deepEqual(
      areaModules(modules, "moderation").map((module) => module.id),
      ["moderation", "automod"],
    );
  });

  test("returns nothing when no module is hosted", () => {
    assert.deepEqual(areaModules([{ id: "welcome", area: null }], "moderation"), []);
  });
});

describe("areaModule", () => {
  test("no id means the area's first module", () => {
    assert.equal(areaModule(modules, "moderation", undefined)?.id, "moderation");
  });

  test("finds a hosted module by id", () => {
    assert.equal(areaModule(modules, "moderation", "automod")?.id, "automod");
  });

  test("does not return a module that lives on its own page", () => {
    assert.equal(areaModule(modules, "moderation", "welcome"), undefined);
  });
});
