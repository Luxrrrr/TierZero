import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../../packages/modules/moderation/test/db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { createDashboardUrlLookup, normalizeDashboardUrl, resolveDashboardUrl, STORED_ADDRESS_TTL_MS } = await import("../dist/runtime/dashboard-url.js");

describe("normalizeDashboardUrl", () => {
  test("keeps only the origin of a web address", () => {
    assert.equal(normalizeDashboardUrl("https://bot.example.com/"), "https://bot.example.com");
    assert.equal(normalizeDashboardUrl("  http://localhost:8081/guilds/1?x=2#top "), "http://localhost:8081");
    assert.equal(normalizeDashboardUrl("https://user:pass@bot.example.com/panel"), "https://bot.example.com");
  });

  test("refuses anything that is not an http or https address", () => {
    for (const bad of ["", "   ", "bot.example.com", "javascript:alert(1)", "ftp://bot.example.com", "https://", null, undefined, 42]) {
      assert.equal(normalizeDashboardUrl(bad), null, String(bad));
    }
  });
});

describe("the dashboard address", () => {
  const reader = (value: string | null, calls: { count: number }) => async () => {
    calls.count += 1;
    return value;
  };

  test("takes the one typed in the settings before the one the web app learned", async () => {
    const calls = { count: 0 };
    const lookup = createDashboardUrlLookup(reader("https://learned.example.com", calls));
    assert.equal(await lookup.resolve("https://typed.example.com/panel/"), "https://typed.example.com");
    assert.equal(calls.count, 0, "the database is not asked when the setting is enough");
  });

  test("falls back to the learned one when the setting is blank or not an address", async () => {
    const lookup = createDashboardUrlLookup(reader("https://learned.example.com/", { count: 0 }));
    assert.equal(await lookup.resolve(undefined), "https://learned.example.com");
    assert.equal(await lookup.resolve(""), "https://learned.example.com");
    assert.equal(await lookup.resolve("not an address"), "https://learned.example.com");
  });

  test("does not link to a learned address that only this machine can open", async () => {
    for (const local of ["http://localhost:8081", "http://127.0.0.1:8081", "http://[::1]:8081", "http://dashboard.localhost"]) {
      assert.equal(await createDashboardUrlLookup(reader(local, { count: 0 })).resolve(undefined), "", local);
    }
    assert.equal(await createDashboardUrlLookup(reader("http://192.168.1.20:8081", { count: 0 })).resolve(undefined), "http://192.168.1.20:8081");
  });

  test("uses a local address when the owner typed it themselves", async () => {
    const lookup = createDashboardUrlLookup(reader(null, { count: 0 }));
    assert.equal(await lookup.resolve("http://localhost:8081"), "http://localhost:8081");
  });

  test("is empty when neither is known", async () => {
    assert.equal(await createDashboardUrlLookup(reader(null, { count: 0 })).resolve(undefined), "");
    assert.equal(await createDashboardUrlLookup(reader("garbage", { count: 0 })).resolve(undefined), "");
  });

  test("is empty, and still answers, when the database cannot be read", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const lookup = createDashboardUrlLookup(async () => {
        throw new Error("database is locked");
      });
      assert.equal(await lookup.resolve(undefined), "");
    } finally {
      console.error = original;
    }
  });

  test("asks the database once for a burst of posts, and again after the cache runs out", async () => {
    const calls = { count: 0 };
    let now = 1_000;
    const lookup = createDashboardUrlLookup(reader("https://learned.example.com", calls), { now: () => now });
    await Promise.all([lookup.resolve(undefined), lookup.resolve(undefined), lookup.resolve(undefined)]);
    await lookup.resolve(undefined);
    assert.equal(calls.count, 1);
    now += STORED_ADDRESS_TTL_MS + 1;
    await lookup.resolve(undefined);
    assert.equal(calls.count, 2);
    lookup.clear();
    await lookup.resolve(undefined);
    assert.equal(calls.count, 3);
  });

  test("is read from the instance row when the setting is blank", async () => {
    await prisma.instance.upsert({ where: { id: 1 }, create: { id: 1, dashboardUrl: "https://stored.example.com/" }, update: { dashboardUrl: "https://stored.example.com/" } });
    assert.equal(await resolveDashboardUrl(undefined), "https://stored.example.com");
    assert.equal(await resolveDashboardUrl("https://typed.example.com"), "https://typed.example.com");
  });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});
