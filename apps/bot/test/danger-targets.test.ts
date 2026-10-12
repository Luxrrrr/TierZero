import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTargets } from "../dist/control/mod/danger.js";

describe("parseTargets", () => {
  test("takes any number of logs, once each", () => {
    assert.deepEqual(parseTargets("mod-logs,staff-activity,mod-logs"), { ok: true, targets: ["mod-logs", "staff-activity"] });
    assert.deepEqual(parseTargets("saved-messages"), { ok: true, targets: ["saved-messages"] });
  });

  test("refuses nothing, and refuses anything it cannot delete", () => {
    assert.equal(parseTargets(null).ok, false);
    assert.equal(parseTargets("").ok, false);
    assert.equal(parseTargets("mod-logs,everything").ok, false);
    assert.equal(parseTargets("members").ok, false);
  });
});
