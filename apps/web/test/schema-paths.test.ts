import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { arrayItemPath, objectChildPath } from "../lib/schema-paths.ts";

describe("objectChildPath", () => {
  test("joins a top-level key with no parent", () => {
    assert.equal(objectChildPath("", "channel"), "channel");
  });

  test("dots a child key onto its parent", () => {
    assert.equal(objectChildPath("panel", "title"), "panel.title");
  });

  test("nests arbitrarily deep", () => {
    assert.equal(objectChildPath("panel.footer", "text"), "panel.footer.text");
  });
});

describe("arrayItemPath", () => {
  test("indexes an item at the top level", () => {
    assert.equal(arrayItemPath("rewards", 2), "rewards[2]");
  });

  test("indexes an item nested under an object path", () => {
    assert.equal(arrayItemPath("panel.buttons", 0), "panel.buttons[0]");
  });

  test("composes with objectChildPath for a field inside an array item", () => {
    const item = arrayItemPath("rewards", 2);
    assert.equal(objectChildPath(item, "role"), "rewards[2].role");
  });
});
