import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { InfractionDto, NoteDto, UserRef } from "@tier0/core";
import {
  buildTimeline,
  caseDomId,
  filterShowing,
  findCaseItem,
  parseCaseHash,
  parseCaseParam,
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
