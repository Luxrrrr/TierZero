import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../dist/template.js";

describe("renderTemplate", () => {
  test("substitutes every declared placeholder", () => {
    const result = renderTemplate("{user} joined {server}, member {memberCount}", {
      user: "<@1>",
      username: "lux",
      server: "TierZero",
      memberCount: "42",
    });
    assert.equal(result, "<@1> joined TierZero, member 42");
  });

  test("leaves plain text with no placeholders untouched", () => {
    const values = { user: "<@1>", username: "lux", server: "TierZero", memberCount: "1" };
    assert.equal(renderTemplate("Welcome!", values), "Welcome!");
  });

  test("repeats a placeholder used more than once", () => {
    const values = { user: "<@1>", username: "lux", server: "s", memberCount: "1" };
    assert.equal(renderTemplate("{user} {user}", values), "<@1> <@1>");
  });

  test("leaves an unrecognized token in place and never drops it", () => {
    const values = { user: "<@1>", username: "lux", server: "s", memberCount: "1" };
    assert.equal(renderTemplate("Hello {nobody}", values), "Hello {nobody}");
  });
});
