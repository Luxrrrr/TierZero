import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MOD_ACTION_KINDS, can, permissionForAction, type StaffDto } from "@tier0/core";
import {
  MATRIX_ROLES,
  PERMISSION_GROUPS,
  PERMISSION_ROWS,
  addState,
  gainedPermissions,
  grantCount,
  isSnowflake,
  matrixGroups,
  needsConfirmation,
  permissionMatrix,
  removalConsequence,
  sortStaff,
  tallyRoles,
  userIdProblem,
} from "../app/guilds/[id]/mod/access/logic.ts";

const person = (userId: string, role: "mod" | "admin", addedAt: string): StaffDto => ({
  user: { userId, name: null, avatarUrl: null, inServer: true },
  role,
  addedBy: { userId: "1", name: null, avatarUrl: null, inServer: true },
  addedAt,
});

describe("permissionMatrix", () => {
  const rows = permissionMatrix();
  const cell = (permission: string, role: string) => {
    const row = rows.find((entry) => entry.permission === permission);
    return row?.allowed[MATRIX_ROLES.indexOf(role as never)];
  };

  test("lists each permission once", () => {
    const names = PERMISSION_ROWS.map((row) => row.permission);
    assert.equal(new Set(names).size, names.length);
  });

  test("gives the owner every listed permission", () => {
    for (const row of rows) assert.equal(row.allowed[MATRIX_ROLES.indexOf("owner")], true, row.permission);
  });

  test("keeps staff management and purging with the owner", () => {
    assert.equal(cell("staff.manage", "admin"), false);
    assert.equal(cell("purge", "admin"), false);
    assert.equal(cell("staff.manage", "owner"), true);
  });

  test("lets admins read the audit trail but not moderators", () => {
    assert.equal(cell("audit.view", "admin"), true);
    assert.equal(cell("audit.view", "mod"), false);
  });

  test("limits who may remove actions other than warns and timeouts", () => {
    assert.equal(cell("infraction.void", "mod"), true);
    assert.equal(cell("infraction.void.any-action", "mod"), false);
    assert.equal(cell("infraction.void.any-action", "admin"), false);
  });

  test("orders the columns from least to most access", () => {
    assert.deepEqual(MATRIX_ROLES, ["mod", "admin", "owner"]);
  });
});

describe("matrix grouping", () => {
  test("keeps every permission in exactly one group", () => {
    const flat = matrixGroups().flatMap((group) => group.rows.map((row) => row.permission));
    assert.equal(flat.length, PERMISSION_ROWS.length);
    assert.equal(new Set(flat).size, flat.length);
  });

  test("names the five groups the owner reads", () => {
    assert.deepEqual(
      PERMISSION_GROUPS.map((group) => group.title),
      ["Viewing", "Notes", "Taking action", "Removing from records", "Administration"],
    );
  });

  test("lists every action a moderator can take, with clearing a timeout under the timeout row", () => {
    const group = matrixGroups().find((entry) => entry.title === "Taking action");
    assert.ok(group);
    assert.deepEqual(
      group.rows.map((row) => row.permission),
      ["action.warn", "action.timeout", "action.kick", "action.ban", "action.unban"],
    );
    assert.match(group.rows[1]!.label, /end a timeout early/);
    for (const kind of MOD_ACTION_KINDS) {
      assert.ok(group.rows.some((row) => row.permission === permissionForAction(kind)), kind);
    }
  });

  test("shows the action grants the bot enforces for each level", () => {
    const group = matrixGroups().find((entry) => entry.title === "Taking action")!;
    for (const row of group.rows) {
      MATRIX_ROLES.forEach((role, index) => assert.equal(row.allowed[index], can(role, row.permission), `${row.permission} ${role}`));
    }
    const allowedFor = (role: "mod" | "admin" | "owner") =>
      group.rows.filter((row) => row.allowed[MATRIX_ROLES.indexOf(role)]).map((row) => row.permission);
    assert.deepEqual(allowedFor("mod"), ["action.warn", "action.timeout"]);
    assert.deepEqual(allowedFor("admin"), ["action.warn", "action.timeout", "action.kick", "action.ban", "action.unban"]);
    assert.equal(allowedFor("owner").length, group.rows.length);
  });

  test("counts grants per level and never exceeds the total", () => {
    const mod = grantCount("mod");
    const admin = grantCount("admin");
    const owner = grantCount("owner");
    assert.equal(owner.granted, owner.total);
    assert.ok(mod.granted < admin.granted && admin.granted < owner.granted);
  });
});

describe("staff list helpers", () => {
  const staff = [
    person("3", "mod", "2026-02-01T00:00:00Z"),
    person("2", "admin", "2026-03-01T00:00:00Z"),
    person("1", "mod", "2026-01-01T00:00:00Z"),
  ];

  test("tallies each level", () => {
    assert.deepEqual(tallyRoles(staff), { mod: 2, admin: 1, total: 3 });
  });

  test("sorts admins first and then by who joined earliest, without mutating the input", () => {
    assert.deepEqual(sortStaff(staff).map((member) => member.user.userId), ["2", "1", "3"]);
    assert.equal(staff[0]!.user.userId, "3");
  });

  test("states what a removal costs in numbers taken from the matrix", () => {
    assert.match(removalConsequence("mod"), new RegExp(`all ${grantCount("mod").granted} permissions`));
    assert.match(removalConsequence("admin"), /admin level/);
  });
});

describe("level changes", () => {
  test("lists what an admin gains over a moderator", () => {
    const gained = gainedPermissions("mod", "admin");
    assert.ok(gained.length > 0);
    assert.ok(gained.some((label) => /audit trail/.test(label)));
    assert.ok(!gained.some((label) => /erase|Choose who has access/.test(label)));
  });

  test("gains nothing when dropping to moderator or staying put", () => {
    assert.deepEqual(gainedPermissions("admin", "mod"), []);
    assert.deepEqual(gainedPermissions("mod", "mod"), []);
  });

  test("asks for confirmation only when permissions widen", () => {
    assert.equal(needsConfirmation("mod", "admin"), true);
    assert.equal(needsConfirmation("admin", "mod"), false);
    assert.equal(needsConfirmation("mod", "mod"), false);
  });
});

describe("addState", () => {
  const existing = new Set(["100000000000000001"]);

  test("waits silently until someone is chosen", () => {
    assert.deepEqual(addState(null, existing), { ok: false, reason: null });
  });

  test("refuses someone already on the list and says where to change them", () => {
    const state = addState("100000000000000001", existing);
    assert.equal(state.ok, false);
    assert.match(state.reason ?? "", /already/);
  });

  test("accepts a new person", () => {
    assert.deepEqual(addState("100000000000000002", existing), { ok: true, reason: null });
  });
});

describe("user id checks", () => {
  test("accepts a snowflake with surrounding space", () => {
    assert.equal(isSnowflake(" 123456789012345678 "), true);
    assert.equal(userIdProblem("123456789012345678"), null);
  });

  test("refuses ids of the wrong length or with letters", () => {
    assert.equal(isSnowflake("1234"), false);
    assert.equal(isSnowflake("1234567890123456789012"), false);
    assert.notEqual(userIdProblem("12345678901234567x"), null);
    assert.notEqual(userIdProblem(""), null);
  });

  test("explains a pasted mention", () => {
    assert.match(userIdProblem("<@123456789012345678>") ?? "", /mention/);
  });
});
