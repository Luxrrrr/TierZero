import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, defineModule, normalizeOrigin, s } from "@tier0/core";
import { dashboardLinks, viewCaseButton } from "../dist/index.js";

describe("dashboardLinks", () => {
  test("points the member's record at one case", () => {
    assert.deepEqual(dashboardLinks("https://bot.example.com", "111", "222", 7), {
      memberUrl: "https://bot.example.com/guilds/111/mod/members/222",
      caseUrl: "https://bot.example.com/guilds/111/mod/members/222?case=7",
    });
  });

  test("has no case link without a case, and nothing at all without an address", () => {
    assert.equal(dashboardLinks("https://bot.example.com", "111", "222").caseUrl, "");
    assert.deepEqual(dashboardLinks("", "111", "222", 7), { memberUrl: "", caseUrl: "" });
  });

  test("the default button is a link that needs {caseUrl}", () => {
    const button = viewCaseButton();
    assert.deepEqual([button.label, button.style, button.url], ["View in dashboard", "link", "{caseUrl}"]);
  });
});

describe("normalizeOrigin", () => {
  test("drops the path, query and trailing slash", () => {
    assert.equal(normalizeOrigin("https://bot.example.com/"), "https://bot.example.com");
    assert.equal(normalizeOrigin("http://192.168.1.5:8081/a/b?c=d"), "http://192.168.1.5:8081");
  });

  test("refuses what is not an http or https address", () => {
    for (const bad of ["", "bot.example.com", "javascript:alert(1)", "file:///etc/passwd"]) assert.equal(normalizeOrigin(bad), null);
  });
});

describe("a string setting that is an origin", () => {
  const settings = s.object({ address: s.string({ optional: true, origin: true }) });
  const registry = new ModuleRegistry();
  registry.register(defineModule({ id: "sample", name: "Sample", summary: "x", category: "utility", settings }));

  test("is stored as the origin", () => {
    const resolved = registry.resolveSettings("sample", { address: "https://bot.example.com/panel/" });
    assert.ok(resolved.ok);
    assert.equal((resolved.value as { address: string }).address, "https://bot.example.com");
  });

  test("may be left blank, and refuses anything that is not a web address", () => {
    assert.equal(registry.resolveSettings("sample", {}).ok, true);
    assert.equal(registry.resolveSettings("sample", { address: "not a url" }).ok, false);
  });

  test("tells the dashboard it is an address", () => {
    const described = settings.describe() as unknown as { fields: { address: { origin?: boolean } } };
    assert.equal(described.fields.address.origin, true);
  });
});
