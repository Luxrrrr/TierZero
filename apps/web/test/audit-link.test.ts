import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AuditDto, AuditKind, UserRef } from "@tier0/shared-moderation";
import { auditEntryLink, memberRecordHref } from "../app/guilds/[id]/mod/audit/params.ts";

const member: UserRef = { userId: "100", name: "LuxTester", avatarUrl: null, inServer: true };

function entry(over: Partial<AuditDto> & { kind: AuditKind }): AuditDto {
  return {
    id: 1,
    at: "2026-10-12T10:00:00Z",
    actor: { userId: "200", name: "Tamsin", role: "admin" },
    label: "",
    summary: "",
    targetUser: member,
    infractionId: null,
    caseNumber: null,
    noteId: null,
    before: null,
    after: null,
    ...over,
  };
}

describe("memberRecordHref", () => {
  test("opens the record, a case or a note", () => {
    assert.equal(memberRecordHref("1", "100"), "/guilds/1/mod/members/100");
    assert.equal(memberRecordHref("1", "100", { caseNumber: 4 }), "/guilds/1/mod/members/100?case=4");
    assert.equal(memberRecordHref("1", "100", { noteId: 9 }), "/guilds/1/mod/members/100?note=9");
  });

  test("a case wins over a note, and the id is encoded", () => {
    assert.equal(memberRecordHref("1", "a b", { caseNumber: 4, noteId: 9 }), "/guilds/1/mod/members/a%20b?case=4");
  });
});

describe("auditEntryLink", () => {
  test("an action opens its case, named for the member", () => {
    const link = auditEntryLink("1", entry({ kind: "action.take", infractionId: 1004, caseNumber: 4 }));
    assert.deepEqual(link, { href: "/guilds/1/mod/members/100?case=4", label: "Open case #4 for LuxTester" });
  });

  test("changes to a case open the case, including a removed one", () => {
    for (const kind of ["infraction.void", "infraction.restore", "infraction.edit"] as const) {
      assert.equal(auditEntryLink("1", entry({ kind, caseNumber: 196 }))?.href, "/guilds/1/mod/members/100?case=196", kind);
    }
  });

  test("note entries open the note", () => {
    for (const kind of ["note.add", "note.edit", "note.delete", "note.restore"] as const) {
      const link = auditEntryLink("1", entry({ kind, noteId: 9 }));
      assert.equal(link?.href, "/guilds/1/mod/members/100?note=9", kind);
      assert.equal(link?.label, "Open a note for LuxTester");
    }
  });

  test("an entry about a member with nothing to point at opens the record", () => {
    const link = auditEntryLink("1", entry({ kind: "infraction.void", infractionId: 5 }));
    assert.deepEqual(link, { href: "/guilds/1/mod/members/100", label: "Open LuxTester's record" });
    assert.equal(auditEntryLink("1", entry({ kind: "note.edit" }))?.href, "/guilds/1/mod/members/100");
  });

  test("a note entry never links by a case number, nor a case entry by a note id", () => {
    assert.equal(auditEntryLink("1", entry({ kind: "note.edit", noteId: 9, caseNumber: 4 }))?.href, "/guilds/1/mod/members/100?note=9");
    assert.equal(auditEntryLink("1", entry({ kind: "action.take", noteId: 9, caseNumber: 4 }))?.href, "/guilds/1/mod/members/100?case=4");
  });

  test("a member the bot cannot name is described by the end of their id", () => {
    const unnamed = { ...member, name: null, userId: "123456789" };
    assert.equal(auditEntryLink("1", entry({ kind: "action.take", targetUser: unnamed, caseNumber: 2 }))?.label, "Open case #2 for User 6789");
  });

  test("entries that are not about a member are not links", () => {
    for (const kind of ["staff.add", "staff.update", "staff.remove", "channel.purge", "messagelog.purge", "logs.purge"] as const) {
      assert.equal(auditEntryLink("1", entry({ kind, targetUser: null })), null, kind);
    }
  });
});
