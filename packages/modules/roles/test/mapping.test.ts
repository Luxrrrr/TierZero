import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMapping, serializeMapping } from "../dist/mapping.js";

describe("serializeMapping / parseMapping", () => {
  test("round trips a menu with emoji", () => {
    const mapping = {
      name: "Colors",
      exclusive: true,
      options: [{ role: "1", label: "Red", emoji: "🔴" }],
    };
    assert.deepEqual(parseMapping(serializeMapping(mapping)), mapping);
  });

  test("round trips an option with no emoji", () => {
    const mapping = { name: "Pings", exclusive: false, options: [{ role: "1", label: "News" }] };
    assert.deepEqual(parseMapping(serializeMapping(mapping)), mapping);
  });

  test("degrades to an empty menu for invalid JSON rather than throwing", () => {
    assert.deepEqual(parseMapping("not json"), { name: "", exclusive: false, options: [] });
  });

  test("drops entries missing a role or label", () => {
    const raw = JSON.stringify({
      name: "Broken",
      exclusive: false,
      options: [{ role: "1", label: "Ok" }, { role: "2" }, { label: "No role" }],
    });
    const parsed = parseMapping(raw);
    assert.deepEqual(parsed.options, [{ role: "1", label: "Ok" }]);
  });

  test("treats a missing exclusive flag as false", () => {
    const raw = JSON.stringify({ name: "Legacy", options: [] });
    assert.equal(parseMapping(raw).exclusive, false);
  });
});
