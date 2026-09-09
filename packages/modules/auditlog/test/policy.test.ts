import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  contentChanged,
  shouldIgnoreChannel,
  shouldLogAuthor,
  shouldLogMessageEdit,
  shouldLogMessageEvent,
} from "../dist/policy.js";

const CATEGORIES = {
  messageDelete: true,
  messageEdit: true,
  memberJoin: true,
  memberLeave: true,
  nicknameChange: true,
  roleChange: true,
  channelCreate: true,
  channelDelete: true,
  roleCreate: false,
  roleDelete: false,
  banAdd: true,
  banRemove: true,
};

function settings(overrides: Partial<typeof CATEGORIES> = {}, extra: Record<string, unknown> = {}) {
  return {
    logChannelId: "log-channel",
    ignoreChannels: ["ignored-channel"],
    includeBots: false,
    categories: { ...CATEGORIES, ...overrides },
    ...extra,
  };
}

describe("shouldIgnoreChannel", () => {
  test("ignores the configured log channel to avoid a logging loop", () => {
    assert.equal(shouldIgnoreChannel("log-channel", settings()), true);
  });

  test("ignores a channel on the ignore list", () => {
    assert.equal(shouldIgnoreChannel("ignored-channel", settings()), true);
  });

  test("does not ignore an unrelated channel", () => {
    assert.equal(shouldIgnoreChannel("general", settings()), false);
  });
});

describe("shouldLogAuthor", () => {
  test("skips bots by default", () => {
    assert.equal(shouldLogAuthor(true, false), false);
  });

  test("logs bots when the operator turned that on", () => {
    assert.equal(shouldLogAuthor(true, true), true);
  });

  test("always logs a human author", () => {
    assert.equal(shouldLogAuthor(false, false), true);
  });
});

describe("contentChanged", () => {
  test("is false when both sides are known and equal", () => {
    assert.equal(contentChanged("same", "same"), false);
  });

  test("is true when both sides are known and differ", () => {
    assert.equal(contentChanged("old", "new"), true);
  });

  test("is true when the prior content is unknown, and not assumed unchanged", () => {
    assert.equal(contentChanged(null, "new"), true);
  });
});

describe("shouldLogMessageEvent", () => {
  test("refuses when the category is switched off", () => {
    assert.equal(
      shouldLogMessageEvent("messageDelete", settings({ messageDelete: false }), {
        channelId: "general",
        authorIsBot: false,
      }),
      false,
    );
  });

  test("refuses in an ignored channel even with the category on", () => {
    assert.equal(
      shouldLogMessageEvent("messageDelete", settings(), { channelId: "ignored-channel", authorIsBot: false }),
      false,
    );
  });

  test("refuses a bot author when bots are excluded", () => {
    assert.equal(
      shouldLogMessageEvent("messageDelete", settings(), { channelId: "general", authorIsBot: true }),
      false,
    );
  });

  test("allows a normal case", () => {
    assert.equal(
      shouldLogMessageEvent("messageDelete", settings(), { channelId: "general", authorIsBot: false }),
      true,
    );
  });
});

describe("shouldLogMessageEdit", () => {
  test("suppresses an edit where the content did not change", () => {
    assert.equal(
      shouldLogMessageEdit(settings(), {
        channelId: "general",
        authorIsBot: false,
        contentBefore: "same",
        contentAfter: "same",
      }),
      false,
    );
  });

  test("logs an edit where the content changed", () => {
    assert.equal(
      shouldLogMessageEdit(settings(), {
        channelId: "general",
        authorIsBot: false,
        contentBefore: "old",
        contentAfter: "new",
      }),
      true,
    );
  });
});
