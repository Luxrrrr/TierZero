import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  automodUser,
  describeLoadError,
  displayName,
  fmtDateTimeUtc,
  fmtDateUtc,
  fmtLocal,
  hueFor,
  infractionStatus,
  initialsFor,
  moderatorOf,
  timeAgo,
} from "../components/mod/format.ts";

describe("hueFor", () => {
  test("is stable for the same id and within range", () => {
    const hue = hueFor("123456789012345678");
    assert.equal(hue, hueFor("123456789012345678"));
    assert.ok(hue >= 0 && hue < 360);
  });

  test("spreads neighbouring ids apart", () => {
    const hues = new Set(["1001", "1002", "1003", "1004", "1005"].map(hueFor));
    assert.ok(hues.size >= 4);
  });
});

describe("initialsFor", () => {
  test("takes the first letters of two words", () => {
    assert.equal(initialsFor({ name: "ada lovelace", userId: "1" }), "AL");
  });

  test("takes two letters of a single word", () => {
    assert.equal(initialsFor({ name: "lux", userId: "1" }), "LU");
  });

  test("splits on underscores and dots", () => {
    assert.equal(initialsFor({ name: "night_owl", userId: "1" }), "NO");
  });

  test("falls back to the id tail for an unknown user, never a question mark", () => {
    assert.equal(initialsFor({ name: null, userId: "998877665544332211" }), "11");
    assert.equal(initialsFor({ name: "   ", userId: "42" }), "42");
  });

  test("does not split a surrogate pair", () => {
    assert.equal([...initialsFor({ name: "\u{1D400}x", userId: "1" })].length, 2);
  });
});

test("displayName uses the id tail when the name is gone", () => {
  assert.equal(displayName({ userId: "123456789", name: null, avatarUrl: null, inServer: false }), "User 6789");
});

describe("infractionStatus", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const by = { userId: "1", name: "a", avatarUrl: null, inServer: true };

  test("removal outranks being in force", () => {
    const voided = { at: "2026-10-01T00:00:00Z", by, reason: null };
    assert.equal(infractionStatus({ action: "ban", active: true, expiresAt: null, voided }, now), "removed");
  });

  test("a running timeout is active", () => {
    assert.equal(infractionStatus({ action: "timeout", active: true, expiresAt: "2026-10-11T00:00:00Z", voided: null }, now), "active");
  });

  test("a timeout past its end is expired even though the stored flag still says active", () => {
    assert.equal(infractionStatus({ action: "timeout", active: true, expiresAt: "2026-10-09T00:00:00Z", voided: null }, now), "expired");
  });

  test("a warn is on record, never active, whatever the stored flag says", () => {
    assert.equal(infractionStatus({ action: "warn", active: true, expiresAt: null, voided: null }, now), "recorded");
  });

  test("a permanent ban is active", () => {
    assert.equal(infractionStatus({ action: "ban", active: true, expiresAt: null, voided: null }, now), "active");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  test("reads naturally across scales", () => {
    assert.equal(timeAgo("2026-10-10T11:59:30Z", now), "just now");
    assert.equal(timeAgo("2026-10-10T11:00:00Z", now), "1 hour ago");
    assert.equal(timeAgo("2026-10-01T12:00:00Z", now), "1 week ago");
    assert.equal(timeAgo("2024-10-01T12:00:00Z", now), "2 years ago");
  });

  test("a time in the future reads as just now", () => {
    assert.equal(timeAgo("2026-10-10T12:05:00Z", now), "just now");
  });
});

describe("date formatting", () => {
  test("server forms are UTC, labelled, and 24-hour", () => {
    assert.equal(fmtDateUtc("2026-10-10T23:30:00Z"), "Oct 10, 2026");
    assert.equal(fmtDateTimeUtc("2026-10-10T23:30:00Z"), "Oct 10, 2026, 23:30 UTC");
  });

  test("the local form follows the given locale and zone and stays 24-hour", () => {
    const text = fmtLocal("2026-10-10T23:30:00Z", "datetime", "en-US", "America/New_York");
    assert.match(text, /19:30/);
    assert.doesNotMatch(text, /PM/);
    assert.match(fmtLocal("2026-10-10T23:30:00Z", "date", "de-DE", "Europe/Berlin"), /11\. Okt\. 2026/);
  });
});

describe("describeLoadError", () => {
  test("an unreachable bot can be retried", () => {
    const copy = describeLoadError(503);
    assert.equal(copy.retry, true);
    assert.equal(copy.tone, "danger");
  });

  test("a refusal cannot be fixed by retrying", () => {
    assert.equal(describeLoadError(403, "the audit log").retry, false);
    assert.match(describeLoadError(403, "the audit log").text, /the audit log/);
  });

  test("a timeout says the bot is slow", () => {
    assert.match(describeLoadError(504).title, /slow/);
  });

  test("no status is treated as unreachable", () => {
    assert.equal(describeLoadError(undefined).title, "The bot is unreachable");
  });
});

describe("one identity for automod", () => {
  const bot = { userId: "42", name: "TierZero", avatarUrl: "https://cdn.example/bot.png", inServer: false };

  test("is named Automod with no Discord avatar", () => {
    assert.deepEqual(automodUser(bot), { userId: "42", name: "Automod", avatarUrl: null, inServer: true, automod: true });
  });

  test("a case by the bot reads as Automod, flagged or not", () => {
    assert.equal(moderatorOf({ action: "automod-warn", moderator: bot }).name, "Automod");
    assert.equal(moderatorOf({ action: "warn", moderator: { ...bot, automod: true } }).automod, true);
  });

  test("a person's case is left as it is", () => {
    const person = { userId: "7", name: "Tamsin", avatarUrl: null, inServer: true };
    assert.equal(moderatorOf({ action: "warn", moderator: person }), person);
  });
});
