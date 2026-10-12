import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canEditInfraction, can, canDeleteNote, canEditNote, canTakeAction, canVoidAction, isInForce, isModActionKind, isStaffRole, permissionForAction } from "../dist/mod.js";

describe("can", () => {
  test("lets every role look and add notes", () => {
    for (const role of ["mod", "admin", "owner"] as const) {
      assert.equal(can(role, "view"), true, role);
      assert.equal(can(role, "note.add"), true, role);
    }
  });

  test("keeps the audit trail from moderators", () => {
    assert.equal(can("mod", "audit.view"), false);
    assert.equal(can("admin", "audit.view"), true);
  });

  test("reserves purging and staff management for the owner", () => {
    for (const permission of ["purge", "staff.manage"] as const) {
      assert.equal(can("mod", permission), false);
      assert.equal(can("admin", permission), false);
      assert.equal(can("owner", permission), true);
    }
  });

  test("lets admins undo a removal but not moderators", () => {
    assert.equal(can("mod", "infraction.restore"), false);
    assert.equal(can("admin", "infraction.restore"), true);
  });
});

describe("canVoidAction", () => {
  test("lets staff remove warns and timeouts only", () => {
    for (const role of ["mod", "admin"] as const) {
      assert.equal(canVoidAction(role, "warn"), true);
      assert.equal(canVoidAction(role, "timeout"), true);
      assert.equal(canVoidAction(role, "ban"), false);
      assert.equal(canVoidAction(role, "kick"), false);
    }
  });

  test("lets the owner remove anything", () => {
    assert.equal(canVoidAction("owner", "ban"), true);
    assert.equal(canVoidAction("owner", "kick"), true);
  });
});

describe("notes", () => {
  test("lets an author change their own note whatever their role", () => {
    assert.equal(canEditNote("mod", true), true);
    assert.equal(canDeleteNote("mod", true), true);
  });

  test("keeps a moderator out of other people's notes", () => {
    assert.equal(canEditNote("mod", false), false);
    assert.equal(canDeleteNote("mod", false), false);
  });

  test("lets an admin change anyone's note", () => {
    assert.equal(canEditNote("admin", false), true);
    assert.equal(canDeleteNote("admin", false), true);
  });
});

describe("isStaffRole", () => {
  test("accepts the three roles and nothing else", () => {
    assert.equal(isStaffRole("mod"), true);
    assert.equal(isStaffRole("superuser"), false);
    assert.equal(isStaffRole(undefined), false);
  });
});

describe("isInForce", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const entry = (over: Partial<Parameters<typeof isInForce>[0]> = {}) => ({
    action: "timeout",
    active: true,
    expiresAt: "2026-10-11T12:00:00Z",
    removed: false,
    ...over,
  });

  test("is true for a timeout that has not run out", () => {
    assert.equal(isInForce(entry(), now), true);
  });

  test("is false for a timeout whose end has passed, even though the stored flag stays set", () => {
    assert.equal(isInForce(entry({ expiresAt: "2026-10-09T12:00:00Z" }), now), false);
  });

  test("is true for a ban with no end until it is cleared", () => {
    assert.equal(isInForce(entry({ action: "ban", expiresAt: null }), now), true);
    assert.equal(isInForce(entry({ action: "ban", expiresAt: null, active: false }), now), false);
  });

  test("is never true for warns, kicks or reversals, whatever their stored flag says", () => {
    for (const action of ["warn", "kick", "unban", "timeout-clear", "automod-warn", "automod-delete"]) {
      assert.equal(isInForce(entry({ action, expiresAt: null }), now), false, action);
    }
  });

  test("counts an automod timeout", () => {
    assert.equal(isInForce(entry({ action: "automod-timeout" }), now), true);
  });

  test("is false for anything staff have removed", () => {
    assert.equal(isInForce(entry({ removed: true }), now), false);
  });
});

describe("canVoidAction for automod entries", () => {
  test("lets staff remove what automod recorded", () => {
    for (const action of ["automod-warn", "automod-timeout", "automod-delete"]) {
      assert.equal(canVoidAction("mod", action), true, action);
    }
  });
});

describe("taking actions", () => {
  test("lets a moderator warn and time out but nothing heavier", () => {
    assert.equal(canTakeAction("mod", "warn"), true);
    assert.equal(canTakeAction("mod", "timeout"), true);
    assert.equal(canTakeAction("mod", "timeout-clear"), true);
    for (const kind of ["kick", "ban", "unban"] as const) assert.equal(canTakeAction("mod", kind), false, kind);
  });

  test("lets an admin kick, ban and unban too", () => {
    for (const kind of ["warn", "timeout", "timeout-clear", "kick", "ban", "unban"] as const) {
      assert.equal(canTakeAction("admin", kind), true, kind);
    }
  });

  test("lets the owner do everything", () => {
    assert.equal(canTakeAction("owner", "ban"), true);
  });

  test("treats clearing a timeout as the same level as setting one", () => {
    assert.equal(permissionForAction("timeout-clear"), "action.timeout");
    assert.equal(permissionForAction("ban"), "action.ban");
  });

  test("recognises only the six action kinds", () => {
    assert.equal(isModActionKind("warn"), true);
    assert.equal(isModActionKind("purge"), false);
    assert.equal(isModActionKind(undefined), false);
  });
});

import { evidenceRefFromLink, parseEvidenceRefs, readEvidence } from "../dist/mod.js";

describe("evidence", () => {
  const ref = { channelId: "123456789012345678", messageId: "223456789012345678" };

  test("reads a list of message ids and drops repeats", () => {
    const result = parseEvidenceRefs([ref, ref]);
    assert.ok(result.ok);
    assert.equal(result.refs.length, 1);
  });

  test("none is fine, and a bad entry is refused", () => {
    assert.deepEqual(parseEvidenceRefs(undefined), { ok: true, refs: [] });
    assert.ok(!parseEvidenceRefs([{ channelId: "x", messageId: "y" }]).ok);
    assert.ok(!parseEvidenceRefs("nope").ok);
  });

  test("limits how many can be attached", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ channelId: "123456789012345678", messageId: String(223456789012345678n + BigInt(i)) }));
    assert.ok(!parseEvidenceRefs(many).ok);
  });

  test("reads a pasted message link", () => {
    assert.deepEqual(evidenceRefFromLink("https://discord.com/channels/1558837695382425641/1558837695973695550/1559010743503036480"), {
      channelId: "1558837695973695550",
      messageId: "1559010743503036480",
    });
    assert.equal(evidenceRefFromLink("https://example.com/channels/1/2/3"), null);
    assert.equal(evidenceRefFromLink("not a link"), null);
  });

  test("damaged stored evidence reads as none", () => {
    assert.deepEqual(readEvidence("{oops"), []);
    assert.deepEqual(readEvidence(null), []);
    assert.deepEqual(readEvidence("[]"), []);
  });
});

describe("evidence versions", () => {
  const base = { channelId: "123456789012345678", messageId: "223456789012345678" };

  test("a version choice is kept, and its absence stays absent", () => {
    const withVersion = parseEvidenceRefs([{ ...base, version: 0 }]);
    assert.ok(withVersion.ok);
    assert.deepEqual(withVersion.refs, [{ ...base, version: 0 }]);
    const without = parseEvidenceRefs([base]);
    assert.ok(without.ok);
    assert.equal("version" in without.refs[0]!, false);
  });

  test("a version that cannot exist is refused", () => {
    assert.ok(!parseEvidenceRefs([{ ...base, version: -1 }]).ok);
    assert.ok(!parseEvidenceRefs([{ ...base, version: 1.5 }]).ok);
    assert.ok(!parseEvidenceRefs([{ ...base, version: 500 }]).ok);
    assert.ok(!parseEvidenceRefs([{ ...base, version: "0" }]).ok);
  });
});

describe("canEditInfraction", () => {
  test("a moderator edits their own cases and no one else's", () => {
    assert.equal(canEditInfraction("mod", true), true);
    assert.equal(canEditInfraction("mod", false), false);
  });

  test("admins and the owner edit any case", () => {
    assert.equal(canEditInfraction("admin", false), true);
    assert.equal(canEditInfraction("owner", false), true);
  });
});

import { SERVER_LOG_CATEGORIES, isServerLogCategory, isServerLogType, serverLogCategoryOf, serverLogTypeLabel } from "../dist/serverlog.js";

describe("the server log catalog", () => {
  test("every type belongs to exactly one category and has a label", () => {
    const seen = new Set<string>();
    for (const category of SERVER_LOG_CATEGORIES) {
      for (const type of category.types) {
        assert.equal(seen.has(type.id), false, `${type.id} is listed twice`);
        seen.add(type.id);
        assert.equal(serverLogCategoryOf(type.id), category.id);
        assert.equal(serverLogTypeLabel(type.id), type.label);
      }
    }
  });

  test("unknown ids are told apart from known ones", () => {
    assert.equal(isServerLogCategory("members"), true);
    assert.equal(isServerLogCategory("nope"), false);
    assert.equal(isServerLogType("member.join"), true);
    assert.equal(isServerLogType("member"), false);
    assert.equal(serverLogTypeLabel("custom.thing"), "custom.thing");
  });
});
