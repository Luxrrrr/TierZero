import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSealed, openToken, sealToken } from "../lib/token-crypto.ts";

const SECRET = "a-long-random-secret-for-the-tests-0123456789abcdef";

describe("token sealing", () => {
  test("a sealed token opens to what was sealed", () => {
    const sealed = sealToken("discord-access-token", SECRET);
    assert.ok(isSealed(sealed));
    assert.ok(!sealed.includes("discord-access-token"));
    assert.equal(openToken(sealed, SECRET), "discord-access-token");
  });

  test("the same token seals differently each time", () => {
    assert.notEqual(sealToken("t", SECRET), sealToken("t", SECRET));
  });

  test("a token sealed with another secret does not open", () => {
    assert.equal(openToken(sealToken("t", SECRET), "another-secret-entirely-0123456789abcdef"), null);
  });

  test("an altered or cut-short token does not open", () => {
    const sealed = sealToken("t", SECRET);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    assert.equal(openToken(flipped, SECRET), null);
    assert.equal(openToken("enc1:abc", SECRET), null);
    assert.equal(openToken("enc1:", SECRET), null);
  });

  test("a token saved before sealing existed is read as it is", () => {
    assert.equal(openToken("plain-old-token", SECRET), "plain-old-token");
    assert.ok(!isSealed("plain-old-token"));
  });

  test("a missing AUTH_SECRET is an error, not a quiet fallback", () => {
    const kept = { a: process.env.AUTH_SECRET, n: process.env.NEXTAUTH_SECRET };
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      assert.throws(() => sealToken("t"), /AUTH_SECRET/);
    } finally {
      if (kept.a !== undefined) process.env.AUTH_SECRET = kept.a;
      if (kept.n !== undefined) process.env.NEXTAUTH_SECRET = kept.n;
    }
  });
});

describe("sealedTokenFields", () => {
  test("seals the tokens that are present and leaves the others out", async () => {
    const { sealedTokenFields } = await import("../lib/token-crypto.ts");
    const fields = sealedTokenFields({ access_token: "a", refresh_token: null, id_token: undefined }, SECRET) as Record<string, string>;
    assert.deepEqual(Object.keys(fields), ["access_token"]);
    assert.equal(openToken(fields.access_token ?? "", SECRET), "a");
    assert.deepEqual(sealedTokenFields({}, SECRET), {});
  });
});
