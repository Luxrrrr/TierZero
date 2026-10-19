import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applicationOwnerId } from "../dist/instance-owner.js";

describe("applicationOwnerId", () => {
  test("a personal application belongs to its user", () => {
    assert.equal(applicationOwnerId({ id: "100000000000000001" }), "100000000000000001");
  });

  test("a team application belongs to the team's owner, not the team", () => {
    assert.equal(applicationOwnerId({ ownerId: "200000000000000002" }), "200000000000000002");
  });

  test("an application whose owner is not known gives nobody", () => {
    assert.equal(applicationOwnerId(null), null);
    assert.equal(applicationOwnerId(undefined), null);
    assert.equal(applicationOwnerId({ ownerId: null }), null);
  });
});
