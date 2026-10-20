import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AuditDto, MemberProfile, NoteDto, UserRef } from "@tier0/shared-moderation";
import { redactProfile } from "../lib/profile-redact.ts";

const user = (userId: string): UserRef => ({ userId, name: userId, avatarUrl: null, inServer: true });

function note(id: number, deleted: boolean): NoteDto {
  return {
    id,
    user: user("100"),
    author: user("200"),
    content: `note ${id}`,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    edited: false,
    deleted: deleted ? { at: "2026-10-02T00:00:00Z", by: user("300") } : null,
  };
}

const entry: AuditDto = {
  id: 1,
  at: "2026-10-02T00:00:00Z",
  actor: { userId: "300", name: "Priya", role: "admin" },
  kind: "note.delete",
  label: "Deleted a note",
  summary: "Deleted a note",
  targetUser: user("100"),
  infractionId: null,
  noteId: 2,
  before: { content: "note 2" },
  after: null,
};

const profile: MemberProfile = {
  user: user("100"),
  joinedAt: null,
  accountCreatedAt: null,
  roles: [],
  summary: {
    user: user("100"),
    infractionCount: 0,
    warnCount: 0,
    timeoutCount: 0,
    banCount: 0,
    kickCount: 0,
    noteCount: 1,
    lastActionAt: null,
    hasActive: false,
    activity: [],
  },
  infractions: [],
  notes: [note(1, false), note(2, true)],
  audit: [entry],
};

describe("redactProfile", () => {
  test("a moderator loses the audit trail and the text of deleted notes", () => {
    const result = redactProfile(profile, "mod");
    assert.deepEqual(result.audit, []);
    assert.equal(result.notes[0]?.content, "note 1");
    assert.equal(result.notes[1]?.content, "");
    assert.deepEqual(result.notes[1]?.deleted, profile.notes[1]?.deleted);
  });

  test("an entry by a Discord moderator is not shown to a moderator either", () => {
    const fromDiscord: AuditDto = { ...entry, actor: { userId: "400", name: "Wren", role: "discord" }, kind: "action.take", noteId: null };
    const result = redactProfile({ ...profile, audit: [fromDiscord] }, "mod");
    assert.deepEqual(result.audit, []);
    assert.equal(redactProfile({ ...profile, audit: [fromDiscord] }, "admin").audit[0]?.actor.role, "discord");
  });

  test("the deleted text does not survive anywhere in what a moderator receives", () => {
    assert.equal(JSON.stringify(redactProfile(profile, "mod")).includes("note 2"), false);
  });

  test("admins and the owner receive the profile untouched", () => {
    assert.equal(redactProfile(profile, "admin"), profile);
    assert.equal(redactProfile(profile, "owner"), profile);
  });

  test("the input is never changed", () => {
    redactProfile(profile, "mod");
    assert.equal(profile.notes[1]?.content, "note 2");
    assert.equal(profile.audit.length, 1);
  });

  test("an empty profile passes through for every role", () => {
    const empty = { ...profile, notes: [], audit: [] };
    assert.deepEqual(redactProfile(empty, "mod"), empty);
  });
});
