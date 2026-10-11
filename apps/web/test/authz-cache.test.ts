import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AUTHZ_FAILURE_MS,
  AUTHZ_FRESH_MS,
  AUTHZ_STALE_MAX_MS,
  afterAuthzFailure,
  isTransientFailure,
  readAuthzCache,
  recordAuthzFailure,
  recordAuthzSuccess,
} from "../lib/authz-cache.ts";

const ids = new Set(["1", "2"]);
const boom = new Error("429");

describe("readAuthzCache", () => {
  test("an unknown user is fetched", () => {
    assert.deepEqual(readAuthzCache(undefined, 0), { kind: "fetch" });
  });

  test("a recent good answer is reused", () => {
    const entry = recordAuthzSuccess(ids, 1_000);
    const read = readAuthzCache(entry, 1_000 + AUTHZ_FRESH_MS - 1);
    assert.equal(read.kind, "use");
    assert.equal(read.kind === "use" && read.stale, false);
  });

  test("an old good answer is refreshed", () => {
    const entry = recordAuthzSuccess(ids, 0);
    assert.deepEqual(readAuthzCache(entry, AUTHZ_FRESH_MS), { kind: "fetch" });
  });

  test("a recent failure with no good answer is repeated without asking Discord", () => {
    const entry = recordAuthzFailure(undefined, boom, 0);
    assert.deepEqual(readAuthzCache(entry, AUTHZ_FAILURE_MS - 1), { kind: "fail", error: boom });
  });

  test("once the failure window passes, Discord is asked again", () => {
    const entry = recordAuthzFailure(undefined, boom, 0);
    assert.deepEqual(readAuthzCache(entry, AUTHZ_FAILURE_MS), { kind: "fetch" });
  });

  test("during a failure the last good answer is served as stale", () => {
    const good = recordAuthzSuccess(ids, 0);
    const failed = recordAuthzFailure(good, boom, AUTHZ_FRESH_MS + 5);
    const read = readAuthzCache(failed, AUTHZ_FRESH_MS + 10);
    assert.equal(read.kind, "use");
    assert.equal(read.kind === "use" && read.stale, true);
  });

  test("a stale answer is never served past fifteen minutes", () => {
    const good = recordAuthzSuccess(ids, 0);
    const failed = recordAuthzFailure(good, boom, AUTHZ_STALE_MAX_MS);
    assert.deepEqual(readAuthzCache(failed, AUTHZ_STALE_MAX_MS + 1), { kind: "fail", error: boom });
  });
});

describe("afterAuthzFailure", () => {
  test("with no earlier answer, the failure stands and access stays denied", () => {
    const entry = recordAuthzFailure(undefined, boom, 0);
    assert.deepEqual(afterAuthzFailure(entry, 0), { kind: "fail", error: boom });
  });

  test("with a young enough earlier answer, that answer is used", () => {
    const entry = recordAuthzFailure(recordAuthzSuccess(ids, 0), boom, 120_000);
    const read = afterAuthzFailure(entry, 120_000);
    assert.equal(read.kind === "use" && read.guildIds, ids);
  });

  test("a success clears the remembered failure", () => {
    const entry = recordAuthzSuccess(ids, 10);
    assert.equal(entry.failure, null);
  });
});

describe("isTransientFailure", () => {
  test("treats a network failure as transient", () => {
    assert.equal(isTransientFailure(new TypeError("fetch failed")), true);
  });

  test("treats a rate limit and server errors as transient", () => {
    for (const status of [429, 500, 502, 503]) assert.equal(isTransientFailure({ status }), true, String(status));
  });

  test("treats a refusal as final, so a revoked grant cannot be kept alive", () => {
    for (const status of [400, 401, 403, 404]) assert.equal(isTransientFailure({ status }), false, String(status));
  });
});
