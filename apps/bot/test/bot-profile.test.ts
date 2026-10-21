import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ActivityType } from "discord.js";

/**
 * The owner can change how the bot shows itself: its status and activity, which
 * are kept across restarts, and its name and picture, which Discord holds.
 */

let dir: string;
let prisma: { $disconnect(): Promise<void> };
let profile: typeof import("../dist/runtime/bot-profile.js");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-profile-"));
  const dbPath = join(dir, "test.db");
  const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");
  const db = new DatabaseSync(dbPath);
  for (const entry of readdirSync(migrations).sort()) {
    try {
      db.exec(readFileSync(join(migrations, entry, "migration.sql"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.close();
  process.env.DATABASE_URL = "file:" + dbPath.split(String.fromCharCode(92)).join("/");
  ({ prisma } = (await import("@tier0/db")) as never);
  profile = await import("../dist/runtime/bot-profile.js");
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

/** A picture the right shape, with enough bytes to pass for one. */
const picture = (mime = "png", bytes = 400) => `data:image/${mime};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

describe("a status and an activity", () => {
  test("are read from what the dashboard sends", () => {
    const parsed = profile.parsePresence({ status: "dnd", activityType: "playing", activityText: "  with   fire " });
    assert.deepEqual(parsed, { ok: true, value: { status: "dnd", activityType: "playing", activityText: "with fire" } });
  });

  test("refuse a status or a kind Discord does not have", () => {
    assert.equal(profile.parsePresence({ status: "away", activityType: "none", activityText: "" }).ok, false);
    assert.equal(profile.parsePresence({ status: "online", activityType: "streaming", activityText: "x" }).ok, false);
    assert.equal(profile.parsePresence(null).ok, false);
  });

  test("need some text when there is an activity, and drop it when there is none", () => {
    assert.equal(profile.parsePresence({ status: "online", activityType: "watching", activityText: "   " }).ok, false);
    const none = profile.parsePresence({ status: "online", activityType: "none", activityText: "left over" });
    assert.deepEqual(none, { ok: true, value: { status: "online", activityType: "none", activityText: "" } });
  });

  test("stop at the 128 characters Discord allows", () => {
    assert.equal(profile.parsePresence({ status: "online", activityType: "playing", activityText: "x".repeat(128) }).ok, true);
    assert.equal(profile.parsePresence({ status: "online", activityType: "playing", activityText: "x".repeat(129) }).ok, false);
  });

  test("become what Discord is sent", () => {
    const sent = (activityType: string, activityText = "something") => profile.presenceData({ status: "idle", activityType, activityText } as never);
    assert.deepEqual(sent("none"), { status: "idle", activities: [] });
    assert.deepEqual(sent("playing").activities, [{ name: "something", type: ActivityType.Playing }]);
    assert.deepEqual(sent("watching").activities, [{ name: "something", type: ActivityType.Watching }]);
    assert.deepEqual(sent("listening").activities, [{ name: "something", type: ActivityType.Listening }]);
    assert.deepEqual(sent("competing").activities, [{ name: "something", type: ActivityType.Competing }]);
    assert.deepEqual(sent("custom").activities, [{ name: "Custom Status", type: ActivityType.Custom, state: "something" }]);
  });
});

describe("a name", () => {
  test("is between 2 and 32 characters once tidied", () => {
    assert.deepEqual(profile.parseName("  Tier   Zero "), { ok: true, value: "Tier Zero" });
    assert.equal(profile.parseName("x").ok, false);
    assert.equal(profile.parseName("x".repeat(33)).ok, false);
    assert.equal(profile.parseName(42).ok, false);
  });
});

describe("a picture", () => {
  test("is a PNG, JPEG, GIF or WebP, or null to take it off", () => {
    for (const kind of ["png", "jpeg", "gif", "webp"]) assert.equal(profile.parseAvatar(picture(kind)).ok, true, kind);
    assert.deepEqual(profile.parseAvatar(null), { ok: true, value: null });
  });

  test("is refused when it is something else", () => {
    assert.equal(profile.parseAvatar("data:text/html;base64,PGI+").ok, false);
    assert.equal(profile.parseAvatar("https://example.com/a.png").ok, false);
    assert.equal(profile.parseAvatar(picture("png", 10)).ok, false);
    assert.equal(profile.parseAvatar(7).ok, false);
  });

  test("is refused when it is larger than Discord takes", () => {
    assert.equal(profile.parseAvatar(picture("png", profile.AVATAR_MAX_BYTES + 100)).ok, false);
  });
});

describe("keeping and applying the profile", () => {
  test("a presence that was never saved is online with no activity, and a saved one comes back", async () => {
    assert.deepEqual(await profile.readPresence(), profile.DEFAULT_PRESENCE);
    await profile.savePresence({ status: "idle", activityType: "listening", activityText: "your messages" });
    assert.deepEqual(await profile.readPresence(), { status: "idle", activityType: "listening", activityText: "your messages" });
  });

  function client(options: { rename?: Error; reface?: Error } = {}) {
    const calls: string[] = [];
    const user = {
      username: "TierZero",
      setUsername: async (name: string) => {
        if (options.rename) throw options.rename;
        calls.push(`name ${name}`);
      },
      setAvatar: async (avatar: string | null) => {
        if (options.reface) throw options.reface;
        calls.push(avatar === null ? "avatar removed" : "avatar set");
      },
      setPresence: (data: unknown) => void calls.push(`presence ${JSON.stringify(data)}`),
    };
    return { client: { user } as never, calls };
  }

  const presence = { status: "dnd" as const, activityType: "playing" as const, activityText: "chess" };

  test("saves and applies the presence, and changes the name and picture only when asked", async () => {
    const { client: bot, calls } = client();
    const result = await profile.applyProfile(bot, { presence, name: "New Name", avatar: picture() });
    assert.deepEqual(result, { presence: "saved", name: "changed", avatar: "changed" });
    assert.equal(calls[0]!.startsWith("presence"), true);
    assert.deepEqual(calls.slice(1), ["name New Name", "avatar set"]);
    assert.deepEqual(await profile.readPresence(), presence);
  });

  test("leaves the name alone when it has not changed, and the picture when none was sent", async () => {
    const { client: bot, calls } = client();
    const result = await profile.applyProfile(bot, { presence, name: "TierZero" });
    assert.deepEqual(result, { presence: "saved", name: "unchanged", avatar: "unchanged" });
    assert.equal(calls.length, 1);
  });

  test("takes the picture off when told to", async () => {
    const { client: bot, calls } = client();
    const result = await profile.applyProfile(bot, { presence, avatar: null });
    assert.equal(result.avatar, "removed");
    assert.ok(calls.includes("avatar removed"));
  });

  test("says which part Discord refused and still keeps the rest", async () => {
    const { client: bot } = client({ rename: new Error("You are changing your username too fast.") });
    const result = await profile.applyProfile(bot, { presence, name: "Another", avatar: picture() });
    assert.deepEqual(result.name, { failed: "You are changing your username too fast." });
    assert.equal(result.avatar, "changed");
    assert.deepEqual(await profile.readPresence(), presence);
  });
});
