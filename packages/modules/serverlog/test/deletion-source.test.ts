import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIMS_LIMIT,
  FRESH_MS,
  decideDeletion,
  deletedByPhrase,
  recordClaim,
  type AuditCandidate,
  type DecideInput,
} from "../dist/deletion-source.js";
import { extrasOf } from "../dist/extras.js";

const AUTHOR = "100000000000000001";
const MOD = "100000000000000002";
const BOT = "100000000000000003";
const OTHER = "100000000000000004";
const CHANNEL = "100000000000000010";

const line = (over: Partial<AuditCandidate> = {}): AuditCandidate => ({
  id: "line-1",
  executorId: MOD,
  executorName: "Marcus",
  targetId: AUTHOR,
  channelId: CHANNEL,
  count: 1,
  ageMs: 1000,
  ...over,
});

const input = (over: Partial<DecideInput> = {}): DecideInput => ({
  note: null,
  candidates: [],
  claims: new Map(),
  authorId: AUTHOR,
  authorName: "LuxTester",
  channelId: CHANNEL,
  botId: BOT,
  botName: "TierZero",
  ...over,
});

const byAuthor = { by: "author", byId: AUTHOR, byName: "LuxTester" };
const byMod = { by: "moderator", byId: MOD, byName: "Marcus" };

describe("decideDeletion", () => {
  const table: Array<[string, Partial<DecideInput>, { by: string; byId: string | null; byName: string | null } | null, string | null]> = [
    ["a note from automod decides it, whatever the audit log says", { note: { by: "automod" }, candidates: [line()] }, { by: "automod", byId: BOT, byName: "Automod" }, null],
    ["a note decides it even when the author is not known", { note: { by: "automod" }, authorId: null }, { by: "automod", byId: BOT, byName: "Automod" }, null],
    ["a note from the bot names the bot", { note: { by: "bot" } }, { by: "bot", byId: BOT, byName: "TierZero" }, null],
    ["a note can carry its own name", { note: { by: "moderator", byId: MOD, byName: "Marcus" } }, byMod, null],
    ["a fresh audit line by someone else is a moderator", { candidates: [line()] }, byMod, "line-1"],
    ["an audit line by the bot is the bot", { candidates: [line({ executorId: BOT, executorName: "x" })] }, { by: "bot", byId: BOT, byName: "TierZero" }, "line-1"],
    ["an audit line by the author is the author", { candidates: [line({ executorId: AUTHOR, executorName: "LuxTester" })] }, byAuthor, "line-1"],
    ["a line about another member is not this message", { candidates: [line({ targetId: OTHER })] }, byAuthor, null],
    ["a line for another channel is not this message", { candidates: [line({ channelId: OTHER })] }, byAuthor, null],
    ["a line that names no channel still matches", { candidates: [line({ channelId: null })] }, byMod, "line-1"],
    ["a line that is too old is not this deletion", { candidates: [line({ ageMs: FRESH_MS + 1 })] }, byAuthor, null],
    ["a line just inside the window counts", { candidates: [line({ ageMs: FRESH_MS })] }, byMod, "line-1"],
    ["no audit lines at all, as with no permission, means the author", { candidates: [] }, byAuthor, null],
    ["the newest matching line wins", { candidates: [line({ id: "new" }), line({ id: "old", executorId: OTHER, executorName: "Ana" })] }, byMod, "new"],
    ["a member nobody knows, with no note, stays unknown", { authorId: null, candidates: [line()] }, null, null],
    ["an old line has room for another deletion when its count grew", { candidates: [line({ ageMs: 120_000, count: 3 })], claims: new Map([["line-1", 2]]) }, byMod, "line-1"],
    ["an old line whose count is used up is not claimed again", { candidates: [line({ ageMs: 120_000, count: 2 })], claims: new Map([["line-1", 2]]) }, byAuthor, null],
    ["a line already used once is not claimed by a later self-delete", { candidates: [line({ count: 1 })], claims: new Map([["line-1", 1]]) }, byAuthor, null],
  ];

  for (const [name, over, source, claimed] of table) {
    test(name, () => {
      const result = decideDeletion(input(over));
      assert.deepEqual(result.source, source);
      assert.equal(result.claimed?.id ?? null, claimed);
    });
  }

  test("two deletions in one batched line both go to the moderator", () => {
    const claims = new Map<string, number>();
    const batched = line({ count: 2 });
    for (let i = 0; i < 2; i++) {
      const result = decideDeletion(input({ candidates: [batched], claims }));
      assert.equal(result.source?.by, "moderator");
      recordClaim(claims, result.claimed!);
    }
    assert.equal(decideDeletion(input({ candidates: [batched], claims })).source?.by, "author");
  });
});

describe("recordClaim", () => {
  test("counts and stays bounded", () => {
    const claims = new Map<string, number>();
    recordClaim(claims, line({ id: "a" }));
    recordClaim(claims, line({ id: "a" }));
    assert.equal(claims.get("a"), 2);
    for (let i = 0; i < CLAIMS_LIMIT + 10; i++) recordClaim(claims, line({ id: `n${i}` }));
    assert.ok(claims.size <= CLAIMS_LIMIT);
    assert.equal(claims.has("a"), false);
  });
});

describe("deletedByPhrase", () => {
  const table: Array<[Parameters<typeof deletedByPhrase>[0], string]> = [
    [null, ""],
    [{ by: "automod", byId: BOT, byName: "Automod" }, " by Automod"],
    [{ by: "author", byId: AUTHOR, byName: "LuxTester" }, " by its author"],
    [{ by: "moderator", byId: MOD, byName: "Marcus" }, " by Marcus"],
    [{ by: "moderator", byId: null, byName: null }, " by a moderator"],
    [{ by: "bot", byId: BOT, byName: "TierZero" }, " by TierZero"],
  ];
  for (const [decision, phrase] of table) {
    test(phrase || "unknown", () => assert.equal(deletedByPhrase(decision), phrase));
  }
});

describe("extrasOf", () => {
  const table: Array<[Parameters<typeof extrasOf>[0], string]> = [
    [{}, ""],
    [{ stickers: { size: 0 }, embeds: [] }, ""],
    [{ stickers: { size: 1 } }, "1 sticker"],
    [{ stickers: { size: 2 }, embeds: [{}] }, "2 stickers, 1 embed"],
    [{ messageSnapshots: { size: 1 } }, "a forwarded message"],
    [{ poll: {} }, "a poll"],
  ];
  for (const [source, expected] of table) {
    test(expected || "nothing", () => assert.equal(extrasOf(source), expected));
  }
});
