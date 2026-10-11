import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  activityTotal,
  ariaSortFor,
  isNarrowed,
  memberListHref,
  memberProfileHref,
  parseMemberQuery,
  sparkPoints,
} from "../app/guilds/[id]/mod/members/params.ts";

describe("parseMemberQuery", () => {
  test("defaults when nothing is given", () => {
    assert.deepEqual(parseMemberQuery({}), { q: "", sort: "recent", filter: "all", page: 1 });
  });

  test("trims the search and keeps a valid sort and page", () => {
    assert.deepEqual(parseMemberQuery({ q: "  alex ", sort: "most", filter: "notes", page: "3" }), {
      q: "alex",
      sort: "most",
      filter: "notes",
      page: 3,
    });
  });

  test("ignores an unknown sort and a bad page", () => {
    assert.deepEqual(parseMemberQuery({ sort: "random", filter: "nope", page: "-2" }), {
      q: "",
      sort: "recent",
      filter: "all",
      page: 1,
    });
    assert.equal(parseMemberQuery({ page: "abc" }).page, 1);
  });

  test("uses the first value of a repeated parameter", () => {
    assert.equal(parseMemberQuery({ q: ["a", "b"] }).q, "a");
  });

  test("caps the search length", () => {
    assert.equal(parseMemberQuery({ q: "x".repeat(500) }).q.length, 100);
  });
});

describe("memberListHref", () => {
  test("omits defaults", () => {
    assert.equal(memberListHref("1", {}), "/guilds/1/mod/members");
    assert.equal(memberListHref("1", { q: "", sort: "recent", filter: "all", page: 1 }), "/guilds/1/mod/members");
  });

  test("includes what differs and encodes the search", () => {
    assert.equal(
      memberListHref("1", { q: "a b", sort: "name", page: 2 }),
      "/guilds/1/mod/members?q=a+b&sort=name&page=2",
    );
  });
});

describe("memberProfileHref", () => {
  test("links to the profile", () => {
    assert.equal(memberProfileHref("1", "42"), "/guilds/1/mod/members/42");
  });
});

describe("filters and sort in the link", () => {
  test("includes a non-default filter and the notes sort", () => {
    assert.equal(
      memberListHref("1", { filter: "active", sort: "notes" }),
      "/guilds/1/mod/members?filter=active&sort=notes",
    );
  });

  test("omits the all filter", () => {
    assert.equal(memberListHref("1", { filter: "all" }), "/guilds/1/mod/members");
  });
});

describe("isNarrowed", () => {
  test("is false only for the untouched view", () => {
    assert.equal(isNarrowed({ q: "", filter: "all" }), false);
    assert.equal(isNarrowed({ q: "x", filter: "all" }), true);
    assert.equal(isNarrowed({ q: "", filter: "recent" }), true);
  });
});

describe("ariaSortFor", () => {
  test("reports the active column only", () => {
    assert.equal(ariaSortFor("recent", "recent"), "descending");
    assert.equal(ariaSortFor("name", "name"), "ascending");
    assert.equal(ariaSortFor("recent", "name"), "none");
  });
});

describe("sparkPoints", () => {
  test("draws nothing for fewer than two values", () => {
    assert.equal(sparkPoints([], 100, 20), "");
    assert.equal(sparkPoints([3], 100, 20), "");
  });

  test("puts the peak at the top and zero at the bottom", () => {
    assert.equal(sparkPoints([0, 4], 100, 20, 2), "2.0,18.0 98.0,2.0");
  });

  test("a flat zero series stays on the baseline", () => {
    assert.equal(sparkPoints([0, 0, 0], 10, 10, 0), "0.0,10.0 5.0,10.0 10.0,10.0");
  });
});

describe("activityTotal", () => {
  test("sums and tolerates a missing series", () => {
    assert.equal(activityTotal([1, 2, 3]), 6);
    assert.equal(activityTotal(undefined), 0);
  });
});
