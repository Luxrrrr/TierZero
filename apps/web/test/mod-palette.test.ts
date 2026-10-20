import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { MemberSummary, UserRef } from "@tier0/shared-moderation";
import { mergeResults, moveActive, opensPalette, paletteMessage } from "../components/mod/palette.ts";

const key = (over: Partial<Parameters<typeof opensPalette>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

describe("opensPalette", () => {
  test("Ctrl+K and Cmd+K open it", () => {
    assert.equal(opensPalette(key({ key: "k", ctrlKey: true })), true);
    assert.equal(opensPalette(key({ key: "K", metaKey: true })), true);
  });

  test("no single-character shortcut opens it", () => {
    assert.equal(opensPalette(key({ key: "/" })), false);
    assert.equal(opensPalette(key({ key: "k" })), false);
  });

  test("other keys and Alt combinations do nothing", () => {
    assert.equal(opensPalette(key({ key: "k" })), false);
    assert.equal(opensPalette(key({ key: "k", ctrlKey: true, altKey: true })), false);
  });
});

describe("moveActive", () => {
  test("wraps at both ends", () => {
    assert.equal(moveActive(2, 1, 3), 0);
    assert.equal(moveActive(0, -1, 3), 2);
  });

  test("starts at the first or last item when nothing is highlighted", () => {
    assert.equal(moveActive(-1, 1, 3), 0);
    assert.equal(moveActive(-1, -1, 3), 2);
  });

  test("an empty list has nothing to highlight", () => {
    assert.equal(moveActive(0, 1, 0), -1);
  });
});

const user = (userId: string): UserRef => ({ userId, name: `n${userId}`, avatarUrl: null, inServer: true });
const summary = (userId: string, infractionCount: number, noteCount = 0): MemberSummary => ({
  user: user(userId),
  infractionCount,
  warnCount: 0,
  timeoutCount: 0,
  banCount: 0,
  kickCount: 0,
  noteCount,
  lastActionAt: null,
  hasActive: false,
  activity: [],
});

describe("mergeResults", () => {
  test("lists people with a record first and does not repeat anyone", () => {
    const merged = mergeResults([summary("1", 2)], [{ user: user("2") }, { user: user("1") }]);
    assert.deepEqual(
      merged.map((result) => result.user.userId),
      ["1", "2"],
    );
    assert.equal(merged[0]!.detail, "2 actions");
    assert.equal(merged[1]!.detail, null);
  });

  test("describes notes and the singular", () => {
    assert.equal(mergeResults([summary("1", 1, 1)], [])[0]!.detail, "1 action · 1 note");
    assert.equal(mergeResults([summary("1", 0)], [])[0]!.detail, "No record");
  });

  test("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ user: user(String(index)) }));
    assert.equal(mergeResults([], many, 8).length, 8);
  });
});

describe("paletteMessage", () => {
  const base = { query: "", recentCount: 3, recentFailed: false, status: "idle" as const, resultCount: 0, failure: null };

  test("announces how many results a search found", () => {
    assert.equal(paletteMessage({ ...base, query: "al", status: "ready", resultCount: 5 }).announce, "5 results");
    assert.equal(paletteMessage({ ...base, query: "al", status: "ready", resultCount: 1 }).announce, "1 result");
  });

  test("says so when nothing matches", () => {
    const message = paletteMessage({ ...base, query: "zz", status: "ready", resultCount: 0 });
    assert.equal(message.announce, 'No members match "zz".');
    assert.equal(message.shown, message.announce);
  });

  test("a session problem reads differently from an unreachable bot", () => {
    assert.match(paletteMessage({ ...base, query: "a", status: "error", failure: 401 }).announce, /session/);
    assert.match(paletteMessage({ ...base, query: "a", status: "error", failure: 503 }).announce, /bot/);
  });

  test("a failed recent list is not reported as an empty one", () => {
    assert.match(paletteMessage({ ...base, recentCount: 0, recentFailed: true }).announce, /could not be loaded/);
  });

  test("nothing is announced while a search is still running", () => {
    assert.equal(paletteMessage({ ...base, query: "a", status: "loading" }).announce, "");
  });
});
