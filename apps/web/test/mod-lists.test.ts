import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dayCountText, isPastEnd } from "../components/mod/format.ts";
import { cueEdges } from "../components/mod/ScrollCues.ts";
import { cleanQuery } from "../app/guilds/[id]/mod/members/params.ts";

describe("a page past the end of a list", () => {
  test("is told apart from a list that is empty", () => {
    assert.equal(isPastEnd(999, 25, 121), true);
    assert.equal(isPastEnd(5, 25, 121), false);
    assert.equal(isPastEnd(6, 25, 121), true);
    assert.equal(isPastEnd(2, 25, 0), false, "an empty list has its own message");
  });
});

describe("day headings on a paged list", () => {
  test("say a day may go on past this page", () => {
    const where = { groups: 3, page: 2, pages: 3 };
    assert.equal(dayCountText(40, { ...where, index: 0 }), "40 entries on this page");
    assert.equal(dayCountText(5, { ...where, index: 1 }), "5 entries");
    assert.equal(dayCountText(3, { ...where, index: 2 }), "3 entries on this page");
  });

  test("count a whole day when the list fits on one page", () => {
    assert.equal(dayCountText(1, { index: 0, groups: 1, page: 1, pages: 1 }), "1 entry");
  });
});

describe("the members search form", () => {
  test("leaves empty fields and defaults out of the address", () => {
    assert.equal(cleanQuery([["q", ""], ["sort", "recent"], ["filter", "all"]]), "");
    assert.equal(cleanQuery([["q", " FragMuffin "], ["sort", "most"], ["filter", "notes"], ["page", "4"]]), "q=FragMuffin&sort=most&filter=notes");
  });
});

describe("the fade on a row that scrolls sideways", () => {
  test("shows on the edges with more past them", () => {
    assert.deepEqual(cueEdges(0, 600, 375), { start: false, end: true });
    assert.deepEqual(cueEdges(225, 600, 375), { start: true, end: false });
    assert.deepEqual(cueEdges(100, 600, 375), { start: true, end: true });
    assert.deepEqual(cueEdges(0, 376, 375), { start: false, end: false }, "a pixel of rounding is not more to see");
  });
});
