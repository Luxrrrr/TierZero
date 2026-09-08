import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categoriesForMemberDiff, diffMember } from "../dist/diff.js";

describe("diffMember", () => {
  test("reports no change for identical snapshots", () => {
    const diff = diffMember(
      { nickname: "Al", roleIds: ["a", "b"] },
      { nickname: "Al", roleIds: ["a", "b"] },
    );
    assert.equal(diff.nicknameChanged, false);
    assert.deepEqual(diff.rolesAdded, []);
    assert.deepEqual(diff.rolesRemoved, []);
  });

  test("detects a nickname change", () => {
    const diff = diffMember({ nickname: "Al", roleIds: [] }, { nickname: "Alex", roleIds: [] });
    assert.equal(diff.nicknameChanged, true);
    assert.equal(diff.nicknameBefore, "Al");
    assert.equal(diff.nicknameAfter, "Alex");
  });

  test("treats a cleared nickname as a change, not a missing value", () => {
    const diff = diffMember({ nickname: "Al", roleIds: [] }, { nickname: null, roleIds: [] });
    assert.equal(diff.nicknameChanged, true);
    assert.equal(diff.nicknameAfter, null);
  });

  test("detects roles added and removed independently", () => {
    const diff = diffMember({ nickname: null, roleIds: ["a", "b"] }, { nickname: null, roleIds: ["b", "c"] });
    assert.deepEqual(diff.rolesAdded, ["c"]);
    assert.deepEqual(diff.rolesRemoved, ["a"]);
  });

  test("does not report a role as both added and removed when order changes", () => {
    const diff = diffMember({ nickname: null, roleIds: ["a", "b"] }, { nickname: null, roleIds: ["b", "a"] });
    assert.deepEqual(diff.rolesAdded, []);
    assert.deepEqual(diff.rolesRemoved, []);
  });
});

describe("categoriesForMemberDiff", () => {
  test("is empty when nothing changed", () => {
    const diff = diffMember({ nickname: "Al", roleIds: ["a"] }, { nickname: "Al", roleIds: ["a"] });
    assert.deepEqual(categoriesForMemberDiff(diff), []);
  });

  test("includes nicknameChange only", () => {
    const diff = diffMember({ nickname: "Al", roleIds: ["a"] }, { nickname: "Alex", roleIds: ["a"] });
    assert.deepEqual(categoriesForMemberDiff(diff), ["nicknameChange"]);
  });

  test("includes roleChange only", () => {
    const diff = diffMember({ nickname: "Al", roleIds: ["a"] }, { nickname: "Al", roleIds: ["a", "b"] });
    assert.deepEqual(categoriesForMemberDiff(diff), ["roleChange"]);
  });

  test("includes both when nickname and roles change together", () => {
    const diff = diffMember({ nickname: "Al", roleIds: ["a"] }, { nickname: "Alex", roleIds: ["a", "b"] });
    assert.deepEqual(categoriesForMemberDiff(diff), ["nicknameChange", "roleChange"]);
  });
});
