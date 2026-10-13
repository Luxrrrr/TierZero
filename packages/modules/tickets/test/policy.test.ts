import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canManageTicket, evaluateOpenRequest } from "../dist/policy.js";

describe("evaluateOpenRequest", () => {
  test("allows a member under their cap with room in the category", () => {
    const decision = evaluateOpenRequest({
      openCount: 0,
      limit: 1,
      categoryExists: true,
      categoryChildCount: 3,
    });
    assert.deepEqual(decision, { allowed: true });
  });

  test("refuses a member already at their cap", () => {
    const decision = evaluateOpenRequest({
      openCount: 1,
      limit: 1,
      categoryExists: true,
      categoryChildCount: 3,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision, { allowed: false, code: "limitOne", openCount: 1, limit: 1 });
  });

  test("names the count when the cap is higher than one", () => {
    const decision = evaluateOpenRequest({
      openCount: 3,
      limit: 3,
      categoryExists: true,
      categoryChildCount: 3,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.deepEqual(decision, { allowed: false, code: "limitMany", openCount: 3, limit: 3 });
  });

  test("refuses when the category no longer exists", () => {
    const decision = evaluateOpenRequest({
      openCount: 0,
      limit: 1,
      categoryExists: false,
      categoryChildCount: 0,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "categoryGone");
  });

  test("refuses when the category is at Discord's 50 channel cap", () => {
    const decision = evaluateOpenRequest({
      openCount: 0,
      limit: 5,
      categoryExists: true,
      categoryChildCount: 50,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "categoryFull");
  });

  test("checks the category before the member's own cap", () => {
    const decision = evaluateOpenRequest({
      openCount: 5,
      limit: 1,
      categoryExists: false,
      categoryChildCount: 0,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "categoryGone");
  });
});

describe("canManageTicket", () => {
  const supportRoles = ["role-support"];

  test("lets the opener manage their own ticket", () => {
    assert.equal(
      canManageTicket({ id: "u1", isOpener: true, roleIds: [], hasManageChannels: false }, supportRoles),
      true,
    );
  });

  test("lets a support role holder manage a ticket that is not theirs", () => {
    assert.equal(
      canManageTicket(
        { id: "u2", isOpener: false, roleIds: ["role-support"], hasManageChannels: false },
        supportRoles,
      ),
      true,
    );
  });

  test("lets Manage Channels override without a support role", () => {
    assert.equal(
      canManageTicket({ id: "u3", isOpener: false, roleIds: [], hasManageChannels: true }, supportRoles),
      true,
    );
  });

  test("refuses an unrelated member with no relevant role or permission", () => {
    assert.equal(
      canManageTicket(
        { id: "u4", isOpener: false, roleIds: ["role-other"], hasManageChannels: false },
        supportRoles,
      ),
      false,
    );
  });
});
