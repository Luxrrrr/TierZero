import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { InfractionDto, NoteDto, UserRef } from "@tier0/shared-moderation";
import {
  badFocusParam,
  buildTimeline,
  caseDomId,
  missingText,
  filterShowing,
  findCaseItem,
  findFocusItem,
  findNoteItem,
  focusDomId,
  focusLabel,
  focusRequest,
  noteDomId,
  parseCaseHash,
  parseCaseParam,
  parseNoteHash,
  parseNoteParam,
} from "../app/guilds/[id]/mod/members/[userId]/timeline.ts";

const user = (userId: string): UserRef => ({ userId, name: userId, avatarUrl: null, inServer: true });

function infraction(caseNumber: number, createdAt: string, extra: Partial<InfractionDto> = {}): InfractionDto {
  return {
    id: caseNumber + 1000,
    caseNumber,
    user: user("100"),
    moderator: user("200"),
    action: "warn",
    reason: null,
    createdAt,
    expiresAt: null,
    active: true,
    voided: null,
    ...extra,
  };
}

const note: NoteDto = {
  id: 7,
  user: user("100"),
  author: user("200"),
  content: "case 3 came up again",
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  edited: false,
  deleted: null,
};

const items = buildTimeline(
  {
    infractions: [
      infraction(3, "2026-10-01T00:00:00Z"),
      infraction(196, "2026-10-03T00:00:00Z", { voided: { at: "2026-10-04T00:00:00Z", by: user("200"), reason: "mistake" } }),
    ],
    notes: [note],
    audit: [],
  },
  false,
);

describe("parseCaseParam", () => {
  test("reads a plain positive number", () => {
    assert.equal(parseCaseParam("196"), 196);
    assert.equal(parseCaseParam(["12", "13"]), 12);
  });

  test("ignores anything that is not just digits", () => {
    for (const bad of ["", "0", "-3", "1e3", "12abc", "1.5", " 4", "99999999999", undefined, []]) {
      assert.equal(parseCaseParam(bad as string | string[] | undefined), null, String(bad));
    }
  });
});

describe("parseCaseHash", () => {
  test("accepts #case-N only", () => {
    assert.equal(parseCaseHash("#case-196"), 196);
    assert.equal(parseCaseHash("#case-0"), null);
    assert.equal(parseCaseHash("#case-"), null);
    assert.equal(parseCaseHash("#pf-timeline-title"), null);
    assert.equal(parseCaseHash("case-5"), null);
  });

  test("matches the id the rows are given", () => {
    assert.equal(parseCaseHash(`#${caseDomId(42)}`), 42);
  });
});

describe("findCaseItem", () => {
  test("finds the row for a case number", () => {
    const found = findCaseItem(items, 3);
    assert.equal(found?.kind, "infraction");
    assert.equal(found?.key, "i1003");
  });

  test("finds a removed case, which the timeline still shows", () => {
    assert.equal(findCaseItem(items, 196)?.key, "i1196");
  });

  test("returns null for a case that is not on the record", () => {
    assert.equal(findCaseItem(items, 4), null);
    assert.equal(findCaseItem(items, null), null);
  });

  test("never matches a note or audit row that merely shares the number", () => {
    assert.equal(findCaseItem(items, 7), null);
  });

  test("a case absent from the timeline the viewer was given stays absent", () => {
    const without = items.filter((item) => item.key !== "i1196");
    assert.equal(findCaseItem(without, 196), null);
  });
});

describe("filterShowing", () => {
  const target = findCaseItem(items, 3)!;

  test("keeps a filter that already shows the case", () => {
    assert.equal(filterShowing(items, "all", target), "all");
    assert.equal(filterShowing(items, "actions", target), "actions");
  });

  test("lifts a filter that would hide it", () => {
    assert.equal(filterShowing(items, "notes", target), "all");
    assert.equal(filterShowing(items, "staff", target), "all");
  });
});

describe("note links", () => {
  test("?note= is read as strictly as ?case=", () => {
    assert.equal(parseNoteParam("7"), 7);
    for (const bad of ["", "0", "-1", "7x", "1e3", undefined, []]) {
      assert.equal(parseNoteParam(bad as string | string[] | undefined), null, String(bad));
    }
  });

  test("#note-N matches the id the rows are given", () => {
    assert.equal(parseNoteHash("#note-7"), 7);
    assert.equal(parseNoteHash(`#${noteDomId(12)}`), 12);
    assert.equal(parseNoteHash("#case-7"), null);
    assert.equal(parseNoteHash("#note-"), null);
  });

  test("finds the row for a note id, and never a case that shares the number", () => {
    assert.equal(findNoteItem(items, 7)?.key, "n7");
    assert.equal(findNoteItem(items, 3), null);
    assert.equal(findNoteItem(items, null), null);
  });

  test("finds a deleted note, which the timeline still shows", () => {
    const deleted = buildTimeline(
      { infractions: [], notes: [{ ...note, deleted: { at: "2026-10-05T00:00:00Z", by: user("200") } }], audit: [] },
      false,
    );
    assert.equal(findNoteItem(deleted, 7)?.key, "n7");
  });

  test("a note absent from the viewer's timeline stays absent", () => {
    assert.equal(findNoteItem(items.filter((item) => item.kind !== "note"), 7), null);
  });

  test("a filter that would hide the note is lifted", () => {
    const target = findNoteItem(items, 7)!;
    assert.equal(filterShowing(items, "notes", target), "notes");
    assert.equal(filterShowing(items, "actions", target), "all");
  });
});

describe("the entry a link opens", () => {
  test("a case wins over a note, and neither gives nothing", () => {
    assert.deepEqual(focusRequest(3, 7), { kind: "case", number: 3 });
    assert.deepEqual(focusRequest(null, 7), { kind: "note", number: 7 });
    assert.equal(focusRequest(null, null), null);
  });

  test("finds, names and anchors each kind", () => {
    const caseRequest = focusRequest(3, null)!;
    const noteRequest = focusRequest(null, 7)!;
    assert.equal(findFocusItem(items, caseRequest)?.key, "i1003");
    assert.equal(findFocusItem(items, noteRequest)?.key, "n7");
    assert.equal(findFocusItem(items, null), null);
    assert.equal(focusDomId(caseRequest), "case-3");
    assert.equal(focusDomId(noteRequest), "note-7");
    assert.equal(focusLabel(caseRequest), "Case #3");
    assert.equal(focusLabel(noteRequest), "Note 7");
  });

  test("says what is wrong with a link that names no entry", () => {
    assert.match(missingText(focusRequest(99999, null)!), /^Case #99999 is not on this member's record\. It may have been purged/);
    assert.equal(badFocusParam("abc", null), "abc");
    assert.equal(badFocusParam(undefined, null), null);
    assert.equal(badFocusParam("12", 12), null);
  });
});
