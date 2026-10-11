import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ActionRefused,
  MAX_BAN_DAYS,
  REASON_REQUIRED,
  actionContext,
  alreadyBanned,
  checkBanDuration,
  checkDeleteDays,
  checkReason,
  checkTargetIdentity,
  checkTimeoutDuration,
  discordFailure,
  needsMember,
  outcomeNotes,
  readRequestFields,
  isAbsentMember,
  isAbsentBan,
  describeDiscordError,
  commandForAction,
  commandSwitchedOff,
  disabledActions,
  shouldMessage,
  banOutlivesTask,
} from "../dist/action-rules.js";

const DAY = 86_400_000;

function refusal(fn: () => unknown): { status: number; message: string } {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ActionRefused, "expected an ActionRefused");
    return { status: error.status, message: error.message };
  }
  assert.fail("expected the call to refuse");
}

describe("checkReason", () => {
  test("trims the reason and treats blank as none", () => {
    assert.equal(checkReason("  spam  ", { requireReason: false }), "spam");
    assert.equal(checkReason("   ", { requireReason: false }), null);
    assert.equal(checkReason(null, { requireReason: false }), null);
  });

  test("refuses a missing or blank reason when the server requires one", () => {
    assert.deepEqual(refusal(() => checkReason(null, { requireReason: true })), {
      status: 400,
      message: REASON_REQUIRED,
    });
    assert.equal(refusal(() => checkReason("  ", { requireReason: true })).status, 400);
  });

  test("allows 500 characters and refuses 501", () => {
    assert.equal(checkReason("a".repeat(500), { requireReason: false })?.length, 500);
    assert.match(refusal(() => checkReason("a".repeat(501), { requireReason: false })).message, /500/);
  });
});

describe("checkTimeoutDuration", () => {
  test("requires a duration", () => {
    assert.equal(refusal(() => checkTimeoutDuration(null)).status, 400);
  });

  test("accepts one second and 28 days exactly", () => {
    assert.equal(checkTimeoutDuration(1000), 1000);
    assert.equal(checkTimeoutDuration(28 * DAY), 28 * DAY);
  });

  test("refuses under a second, over 28 days, zero, fractions and non-finite values", () => {
    assert.match(refusal(() => checkTimeoutDuration(999)).message, /at least one second/);
    assert.match(refusal(() => checkTimeoutDuration(28 * DAY + 1)).message, /28 days/);
    assert.match(refusal(() => checkTimeoutDuration(0)).message, /greater than zero/);
    assert.match(refusal(() => checkTimeoutDuration(1500.5)).message, /whole number/);
    assert.equal(refusal(() => checkTimeoutDuration(Number.POSITIVE_INFINITY)).status, 400);
  });
});

describe("checkBanDuration", () => {
  test("treats no duration as a permanent ban", () => {
    assert.equal(checkBanDuration(null), null);
  });

  test("accepts a temporary ban up to the ceiling", () => {
    assert.equal(checkBanDuration(7 * DAY), 7 * DAY);
    assert.equal(checkBanDuration(MAX_BAN_DAYS * DAY), MAX_BAN_DAYS * DAY);
  });

  test("refuses zero, negatives, under a second and past the ceiling", () => {
    assert.equal(refusal(() => checkBanDuration(0)).status, 400);
    assert.equal(refusal(() => checkBanDuration(-5)).status, 400);
    assert.equal(refusal(() => checkBanDuration(500)).status, 400);
    assert.match(refusal(() => checkBanDuration(MAX_BAN_DAYS * DAY + 1)).message, /permanent/);
  });
});

describe("checkDeleteDays", () => {
  test("falls back to the server's setting", () => {
    assert.equal(checkDeleteDays(null, 3), 3);
  });

  test("accepts 0 to 7 and refuses anything else", () => {
    assert.equal(checkDeleteDays(0, 3), 0);
    assert.equal(checkDeleteDays(7, 0), 7);
    assert.equal(refusal(() => checkDeleteDays(8, 0)).status, 400);
    assert.equal(refusal(() => checkDeleteDays(-1, 0)).status, 400);
    assert.equal(refusal(() => checkDeleteDays(1.5, 0)).status, 400);
  });
});

describe("checkTargetIdentity", () => {
  test("refuses acting on yourself or on the bot", () => {
    assert.match(refusal(() => checkTargetIdentity("1", "1", "9")).message, /yourself/);
    assert.match(refusal(() => checkTargetIdentity("9", "1", "9")).message, /against itself/);
  });

  test("allows anyone else, including when the bot's id is unknown", () => {
    checkTargetIdentity("2", "1", "9");
    checkTargetIdentity("2", "1", null);
  });
});

describe("needsMember", () => {
  test("lets the dashboard warn someone who has left but not the slash command", () => {
    assert.equal(needsMember("warn", "dashboard"), false);
    assert.equal(needsMember("warn", "command"), true);
  });

  test("needs the member for anything Discord does to them in the server", () => {
    for (const origin of ["command", "dashboard"] as const) {
      assert.equal(needsMember("timeout", origin), true);
      assert.equal(needsMember("timeout-clear", origin), true);
      assert.equal(needsMember("kick", origin), true);
      assert.equal(needsMember("ban", origin), false);
      assert.equal(needsMember("unban", origin), false);
    }
  });
});

describe("readRequestFields", () => {
  test("reads the fields that apply and ignores the rest", () => {
    assert.deepEqual(readRequestFields("warn", { reason: "x", durationMs: "junk", deleteDays: {} }), {
      reason: "x",
      durationMs: null,
      deleteDays: null,
    });
    assert.deepEqual(readRequestFields("timeout", { durationMs: 60000, deleteDays: 3 }), {
      reason: null,
      durationMs: 60000,
      deleteDays: null,
    });
    assert.deepEqual(readRequestFields("ban", { durationMs: null, deleteDays: 2 }), {
      reason: null,
      durationMs: null,
      deleteDays: 2,
    });
  });

  test("refuses a field of the wrong type when it applies", () => {
    assert.equal(refusal(() => readRequestFields("warn", { reason: 5 })).status, 400);
    assert.equal(refusal(() => readRequestFields("timeout", { durationMs: "10m" })).status, 400);
    assert.equal(refusal(() => readRequestFields("ban", { deleteDays: "7" })).status, 400);
  });
});

describe("actionContext", () => {
  test("passes the settings through with the fixed limits", () => {
    const dto = actionContext({
      requireReason: true,
      dmOnAction: false,
      defaultTimeoutDuration: 600000,
      deleteMessageDays: 1,
    });
    assert.deepEqual(dto, {
      requireReason: true,
      dmOnAction: false,
      defaultTimeoutMs: 600000,
      maxTimeoutMs: 28 * DAY,
      deleteMessageDays: 1,
      maxBanDays: MAX_BAN_DAYS,
    });
  });
});

describe("wording", () => {
  test("keeps the slash command's own messages", () => {
    assert.equal(alreadyBanned("sam", "command"), "sam is already banned. Use /unban first to change it.");
    assert.equal(discordFailure("timeout", "command"), "I could not time that member out. Check that my role is above theirs.");
    assert.equal(discordFailure("timeout-clear", "command"), "I could not clear that timeout. Check my permissions.");
    assert.equal(discordFailure("kick", "command"), "I could not kick that member. Check that my role is above theirs.");
    assert.equal(discordFailure("ban", "command"), "I could not ban that member. Check that my role is above theirs.");
    assert.equal(discordFailure("unban", "command"), "I could not lift that ban. Check my permissions.");
  });

  test("speaks about the bot rather than as it on the dashboard", () => {
    assert.doesNotMatch(alreadyBanned("sam", "dashboard"), /\/unban/);
    assert.match(discordFailure("kick", "dashboard"), /^The bot could not kick/);
  });
});

describe("outcomeNotes", () => {
  const quiet = { dm: "sent", modLog: "posted", targetInServer: true } as const;

  test("says nothing when everything went as expected", () => {
    assert.deepEqual(outcomeNotes({ action: "warn", ...quiet }), []);
    assert.deepEqual(outcomeNotes({ action: "kick", ...quiet, dm: "off", modLog: "unset" }), []);
  });

  test("reports an undelivered direct message", () => {
    const notes = outcomeNotes({ action: "kick", ...quiet, dm: "failed" });
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /direct message/);
  });

  test("reports a mod log post that did not happen", () => {
    assert.match(outcomeNotes({ action: "ban", ...quiet, modLog: "failed" })[0]!, /mod log post failed/);
    assert.match(outcomeNotes({ action: "ban", ...quiet, modLog: "missing" })[0]!, /no longer exists/);
  });

  test("explains a warning or ban against someone who has left", () => {
    assert.match(outcomeNotes({ action: "warn", ...quiet, targetInServer: false })[0]!, /record only/);
    assert.match(outcomeNotes({ action: "ban", ...quiet, targetInServer: false })[0]!, /joining again/);
  });
});

describe("reading Discord lookup failures", () => {
  test("only Discord's own answer means the member is not there", () => {
    assert.equal(isAbsentMember({ code: 10007 }), true);
    assert.equal(isAbsentMember({ code: 10013 }), true);
    assert.equal(isAbsentMember({ code: 50001 }), false);
    assert.equal(isAbsentMember(new Error("socket hang up")), false);
    assert.equal(isAbsentMember(null), false);
  });

  test("only Discord's own answer means there is no ban", () => {
    assert.equal(isAbsentBan({ code: 10026 }), true);
    assert.equal(isAbsentBan({ code: 10007 }), false);
    assert.equal(isAbsentBan(new Error("timeout")), false);
  });

  test("describes an error by its code and message only", () => {
    const error = Object.assign(new Error("Missing Permissions"), { code: 50013 });
    assert.equal(describeDiscordError(error), "50013 Missing Permissions");
    assert.equal(describeDiscordError(new Error("boom")), "boom");
  });
});

describe("Commands page switches", () => {
  test("a timeout clear answers to the timeout command", () => {
    assert.equal(commandForAction("timeout-clear"), "timeout");
    assert.equal(commandForAction("ban"), "ban");
  });

  test("words each refusal for its action", () => {
    assert.equal(commandSwitchedOff("ban"), "Banning is switched off for this server on the Commands page.");
    assert.equal(commandSwitchedOff("timeout-clear"), "Timeouts are switched off for this server on the Commands page.");
    assert.equal(commandSwitchedOff("warn"), "Warning is switched off for this server on the Commands page.");
  });

  test("lists the actions behind switched-off commands and ignores other commands", () => {
    assert.deepEqual(disabledActions(["timeout", "ping", "unban"]), ["timeout", "timeout-clear", "unban"]);
    assert.deepEqual(disabledActions([]), []);
  });
});

describe("shouldMessage", () => {
  test("sends nothing when the setting is off", () => {
    assert.equal(shouldMessage("warn", "dashboard", true, false), "off");
  });

  test("withholds a dashboard message to someone not in the server", () => {
    for (const action of ["warn", "timeout", "timeout-clear", "kick", "ban"] as const) {
      assert.equal(shouldMessage(action, "dashboard", false, true), "withheld");
    }
  });

  test("still messages a confirmed ban on unban, and anyone a slash command names", () => {
    assert.equal(shouldMessage("unban", "dashboard", false, true), "send");
    assert.equal(shouldMessage("ban", "command", false, true), "send");
    assert.equal(shouldMessage("warn", "dashboard", true, true), "send");
  });

  test("a withheld message becomes a note", () => {
    const notes = outcomeNotes({ action: "ban", dm: "withheld", modLog: "posted", targetInServer: false });
    assert.ok(notes.includes("They are not in the server, so they were not sent a direct message."));
  });
});

describe("banOutlivesTask", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  test("lets the task run when the newest open ban is the one that ended", () => {
    assert.equal(banOutlivesTask({ expiresAt: now }, now), false);
    assert.equal(banOutlivesTask({ expiresAt: new Date(now.getTime() - 1000) }, now), false);
    assert.equal(banOutlivesTask(null, now), false);
  });

  test("leaves a newer permanent or still-running ban alone", () => {
    assert.equal(banOutlivesTask({ expiresAt: null }, now), true);
    assert.equal(banOutlivesTask({ expiresAt: new Date(now.getTime() + 60_000) }, now), true);
  });
});
