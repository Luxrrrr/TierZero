import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseVersion } from "../lib/version.ts";
import { parseRoadmap } from "../lib/roadmap.ts";

describe("versions", () => {
  test("reads a release tag, with or without the v, and ignores a pre-release suffix", () => {
    assert.deepEqual(parseVersion("v0.2.1"), [0, 2, 1]);
    assert.deepEqual(parseVersion("1.10.3"), [1, 10, 3]);
    assert.deepEqual(parseVersion("v1.0.0-beta.2"), [1, 0, 0]);
    assert.equal(parseVersion("latest"), null);
    assert.equal(parseVersion("0.2"), null);
  });

  test("compares numbers, not text", () => {
    assert.ok(compareVersions("v0.10.0", "0.9.9") > 0);
    assert.ok(compareVersions("0.2.1", "v0.2.2") < 0);
    assert.equal(compareVersions("v0.2.1", "0.2.1"), 0);
  });

  test("something that is not a version never counts as newer", () => {
    assert.equal(compareVersions("nightly", "0.2.1"), 0);
  });
});

describe("parseRoadmap", () => {
  test("keeps well formed items and drops the rest", () => {
    const items = parseRoadmap({
      items: [
        { title: "A", description: "first", status: "planned" },
        { title: "", status: "planned" },
        { title: "B", status: "someday" },
        "nope",
        { title: "C", status: "in-progress" },
      ],
    });
    assert.deepEqual(items.map((i) => i.title), ["A", "C"]);
    assert.equal(items[1]?.description, "");
  });

  test("anything that is not a roadmap gives an empty list", () => {
    assert.deepEqual(parseRoadmap(null), []);
    assert.deepEqual(parseRoadmap({ items: "x" }), []);
    assert.deepEqual(parseRoadmap([]), []);
  });
});
