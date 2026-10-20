import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ActionContextDto, InfractionDto, UserRef } from "@tier0/shared-moderation";
import {
  BAN_PRESETS,
  DAY_MS,
  DISCORD_TIMEOUT_MAX_MS,
  HOUR_MS,
  MINUTE_MS,
  TIMEOUT_PRESETS,
  actionOptions,
  actionTitle,
  banMax,
  buildRequest,
  clampDeleteDays,
  confirmLabel,
  consequences,
  deletionChoiceText,
  describeMs,
  draftMs,
  durationProblem,
  endsAt,
  enterKeyAction,
  failureLead,
  initialDuration,
  memberState,
  offersDeletion,
  presetsWithin,
  readContext,
  readResult,
  readStanding,
  earlierEndWarning,
  unchosenDuration,
  reasonProblem,
  shortName,
  splitMs,
  successTitle,
  timeoutMax,
  type ActionDraft,
  type EnterKey,
  type MemberState,
} from "../app/guilds/[id]/mod/members/[userId]/actions.ts";
import { confirmationProblem, counterAnnouncement } from "../app/guilds/[id]/mod/members/[userId]/timeline.ts";

const NOW = new Date("2026-10-10T12:00:00Z");

const ref = (userId: string, inServer = true): UserRef => ({ userId, name: `user ${userId}`, avatarUrl: null, inServer });

let nextId = 1;
function entry(action: string, fields: Partial<InfractionDto> = {}): InfractionDto {
  const id = nextId++;
  return {
    id,
    caseNumber: id,
    user: ref("1"),
    moderator: ref("2"),
    action,
    reason: null,
    createdAt: "2026-10-09T12:00:00Z",
    expiresAt: null,
    active: true,
    voided: null,
    ...fields,
  };
}

const context: ActionContextDto = {
  moduleEnabled: true,
  requireReason: false,
  dmOnAction: true,
  dmIncludeMessages: true,
  deleteMessagesByDefault: false,
  defaultTimeoutMs: 10 * MINUTE_MS,
  maxTimeoutMs: DISCORD_TIMEOUT_MAX_MS,
  deleteMessageDays: 1,
  maxBanDays: 30,
};

const present: MemberState = { inServer: true, banned: false, timedOut: false, timeoutUntil: null };

describe("memberState", () => {
  test("reads a running timeout, including one automod set", () => {
    const until = "2026-10-11T00:00:00Z";
    const state = memberState({ user: { inServer: true }, infractions: [entry("automod-timeout", { expiresAt: until })] }, NOW);
    assert.equal(state.timedOut, true);
    assert.equal(state.timeoutUntil, until);
    assert.equal(state.banned, false);
  });

  test("ignores a timeout that has run out even though the stored flag is still set", () => {
    const state = memberState(
      { user: { inServer: true }, infractions: [entry("timeout", { expiresAt: "2026-10-10T11:00:00Z", active: true })] },
      NOW,
    );
    assert.equal(state.timedOut, false);
  });

  test("ignores a removed ban and a lifted ban", () => {
    const removed = entry("ban", { voided: { at: "2026-10-09T13:00:00Z", by: ref("3"), reason: null } });
    const lifted = entry("ban", { active: false });
    assert.equal(memberState({ user: { inServer: false }, infractions: [removed, lifted] }, NOW).banned, false);
  });

  test("sees a permanent ban as in force", () => {
    const state = memberState({ user: { inServer: false }, infractions: [entry("ban")] }, NOW);
    assert.equal(state.banned, true);
    assert.equal(state.inServer, false);
  });

  test("never reads a warn as a restriction", () => {
    const state = memberState({ user: { inServer: true }, infractions: [entry("warn")] }, NOW);
    assert.deepEqual(state, present);
  });
});

describe("actionOptions", () => {
  const kinds = (role: "mod" | "admin" | "owner", state: MemberState) => actionOptions(role, state).map((option) => option.kind);

  test("a moderator sees only warn and timeout", () => {
    assert.deepEqual(kinds("mod", present), ["warn", "timeout"]);
  });

  test("an admin and the owner also see kick and ban", () => {
    assert.deepEqual(kinds("admin", present), ["warn", "timeout", "kick", "ban"]);
    assert.deepEqual(kinds("owner", present), ["warn", "timeout", "kick", "ban"]);
  });

  test("clear timeout appears only while a timeout is running, for anyone who can time out", () => {
    const timedOut = { ...present, timedOut: true, timeoutUntil: "2026-10-11T00:00:00Z" };
    assert.deepEqual(kinds("mod", timedOut), ["warn", "timeout", "timeout-clear"]);
    const change = actionOptions("mod", timedOut).find((option) => option.kind === "timeout");
    assert.equal(change?.label, "Change timeout");
  });

  test("unban replaces ban while the member is banned, and a moderator sees neither", () => {
    const banned = { ...present, inServer: false, banned: true };
    assert.deepEqual(kinds("admin", banned), ["warn", "timeout", "kick", "unban"]);
    assert.deepEqual(kinds("mod", banned), ["warn", "timeout"]);
  });

  test("timeout and kick stay listed with a reason when the member has left, and ban stays usable", () => {
    const left = actionOptions("admin", { ...present, inServer: false });
    const byKind = new Map(left.map((option) => [option.kind, option]));
    assert.match(byKind.get("timeout")?.unavailable ?? "", /out of the server/);
    assert.match(byKind.get("kick")?.unavailable ?? "", /out of the server/);
    assert.equal(byKind.get("warn")?.unavailable, null);
    assert.equal(byKind.get("ban")?.unavailable, null);
  });

  test("actions switched off on the Commands page are left out, whatever the role", () => {
    assert.deepEqual(kinds("owner", present).filter((kind) => kind !== "kick"), actionOptions("owner", present, ["kick"]).map((o) => o.kind));
    const timedOut = { ...present, timedOut: true, timeoutUntil: "2026-10-11T00:00:00Z" };
    assert.deepEqual(
      actionOptions("mod", timedOut, ["timeout", "timeout-clear"]).map((option) => option.kind),
      ["warn"],
    );
    assert.deepEqual(actionOptions("mod", present, ["warn", "timeout"]), []);
  });

  test("only kick and ban are marked heavy", () => {
    const heavy = actionOptions("owner", present).filter((option) => option.heavy).map((option) => option.kind);
    assert.deepEqual(heavy, ["kick", "ban"]);
  });
});

describe("wording", () => {
  test("titles and buttons name the member", () => {
    assert.equal(actionTitle("ban", "Priya"), "Ban Priya");
    assert.equal(actionTitle("timeout-clear", "Priya"), "Clear Priya’s timeout");
    assert.equal(confirmLabel("kick", "Priya"), "Kick Priya");
  });

  test("a long name is shortened on the button but kept whole in the title", () => {
    const name = "A very long display name that goes on";
    assert.equal(actionTitle("ban", name), `Ban ${name}`);
    assert.ok(confirmLabel("ban", name).length <= "Ban ".length + 24);
    assert.ok(confirmLabel("ban", name).endsWith("…"));
    assert.equal(shortName("  Priya  "), "Priya");
  });

  test("the success toast gives the case number", () => {
    assert.equal(successTitle("ban", "Priya", 61), "Banned Priya. Case #61.");
    assert.equal(successTitle("timeout-clear", "Priya", 7), "Cleared Priya’s timeout. Case #7.");
    assert.equal(successTitle("kick", "Priya", null), "Kicked Priya.");
  });

  test("a refusal starts by saying what did not happen", () => {
    assert.equal(failureLead("ban", "Priya"), "Priya was not banned");
    assert.equal(failureLead("timeout-clear", "Priya"), "Priya’s timeout was not cleared");
  });
});

describe("lengths", () => {
  test("describes a length in the coarsest exact unit", () => {
    assert.equal(describeMs(60_000), "1 minute");
    assert.equal(describeMs(90 * MINUTE_MS), "90 minutes");
    assert.equal(describeMs(28 * DAY_MS), "28 days");
    assert.equal(describeMs(1500), "2 seconds");
  });

  test("splits a length for the custom fields", () => {
    assert.deepEqual(splitMs(2 * HOUR_MS), { amount: "2", unit: "h" });
    assert.deepEqual(splitMs(90 * 1000), { amount: "90", unit: "s" });
  });

  test("never lets a timeout pass Discord's ceiling, whatever the server says", () => {
    assert.equal(timeoutMax({ maxTimeoutMs: 40 * DAY_MS }), DISCORD_TIMEOUT_MAX_MS);
    assert.equal(timeoutMax({ maxTimeoutMs: DAY_MS }), DAY_MS);
    assert.equal(timeoutMax({ maxTimeoutMs: 0 }), DISCORD_TIMEOUT_MAX_MS);
  });

  test("a server with no ban ceiling set allows only permanent bans", () => {
    assert.equal(banMax({ maxBanDays: 0 }), 0);
    assert.equal(banMax({ maxBanDays: 30 }), 30 * DAY_MS);
  });

  test("hides presets past the ceiling", () => {
    assert.deepEqual(
      presetsWithin(TIMEOUT_PRESETS, DAY_MS).map((preset) => preset.label),
      ["60 seconds", "5 minutes", "1 hour", "1 day"],
    );
    assert.deepEqual(presetsWithin(BAN_PRESETS, 7 * DAY_MS).map((preset) => preset.label), ["1 day", "3 days", "7 days"]);
  });

  test("starts on the matching preset, or the default written out as a custom length", () => {
    assert.deepEqual(initialDuration(TIMEOUT_PRESETS, HOUR_MS, DISCORD_TIMEOUT_MAX_MS), { choice: HOUR_MS, amount: "1", unit: "h" });
    assert.deepEqual(initialDuration(TIMEOUT_PRESETS, 10 * MINUTE_MS, DISCORD_TIMEOUT_MAX_MS), {
      choice: "custom",
      amount: "10",
      unit: "m",
    });
  });

  test("a default past the ceiling starts at the ceiling", () => {
    const draft = initialDuration(TIMEOUT_PRESETS, 7 * DAY_MS, DAY_MS);
    assert.equal(draftMs(draft), DAY_MS);
  });

  test("reads a custom length and refuses anything that is not a whole number", () => {
    assert.equal(draftMs({ choice: "custom", amount: "3", unit: "d" }), 3 * DAY_MS);
    assert.equal(draftMs({ choice: "custom", amount: "1.5", unit: "h" }), null);
    assert.equal(draftMs({ choice: "custom", amount: "", unit: "h" }), null);
  });

  test("explains each way a length can be wrong", () => {
    const max = DISCORD_TIMEOUT_MAX_MS;
    assert.match(durationProblem({ choice: "custom", amount: "", unit: "m" }, max, "timeout") ?? "", /how long the timeout/);
    assert.match(durationProblem({ choice: "custom", amount: "0", unit: "m" }, max, "timeout") ?? "", /more than zero/);
    assert.match(durationProblem({ choice: "custom", amount: "29", unit: "d" }, max, "timeout") ?? "", /28 days/);
    assert.match(durationProblem({ choice: "custom", amount: "8", unit: "d" }, 7 * DAY_MS, "ban") ?? "", /up to 7 days/);
    assert.equal(durationProblem({ choice: "custom", amount: "28", unit: "d" }, max, "timeout"), null);
  });

  test("works out when a length ends", () => {
    assert.equal(endsAt(HOUR_MS, NOW), "2026-10-10T13:00:00.000Z");
  });

  test("keeps message deletion within the 0 to 7 days Discord accepts", () => {
    assert.equal(clampDeleteDays(9), 7);
    assert.equal(clampDeleteDays(-1), 0);
    assert.equal(clampDeleteDays(Number.NaN), 0);
    assert.equal(clampDeleteDays(2.7), 2);
  });
});

describe("buildRequest", () => {
  const draft = (fields: Partial<ActionDraft>): ActionDraft => ({
    kind: "warn",
    reason: "",
    duration: { choice: HOUR_MS, amount: "1", unit: "h" },
    banLength: "permanent",
    deleteDays: 3,
    ...fields,
  });

  test("a warn sends only the reason, trimmed", () => {
    assert.deepEqual(buildRequest(draft({ reason: "  spam  " }), context), {
      ok: true,
      request: { action: "warn", reason: "spam", durationMs: null, deleteDays: null },
    });
  });

  test("attached messages are sent, and left out when there are none", () => {
    const ref = { channelId: "123456789012345678", messageId: "223456789012345678" };
    const withEvidence = buildRequest(draft({ reason: "spam", evidence: [ref] }), context);
    assert.ok(withEvidence.ok);
    assert.deepEqual(withEvidence.request.evidence, [ref]);
    const without = buildRequest(draft({ reason: "spam", evidence: [] }), context);
    assert.ok(without.ok);
    assert.equal("evidence" in without.request, false);
  });

  test("an action that adds nothing to the record carries no messages", () => {
    const ref = { channelId: "123456789012345678", messageId: "223456789012345678" };
    const result = buildRequest(draft({ kind: "unban", reason: "ok", evidence: [ref] }), context);
    assert.ok(result.ok);
    assert.equal("evidence" in result.request, false);
  });

  test("an empty optional reason is sent as null", () => {
    const result = buildRequest(draft({}), context);
    assert.ok(result.ok);
    assert.equal(result.request.reason, null);
  });

  test("a required reason is enforced", () => {
    const result = buildRequest(draft({ reason: "   " }), { ...context, requireReason: true });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : (result.errors.reason ?? ""), /reason/);
  });

  test("a timeout sends its length", () => {
    const result = buildRequest(draft({ kind: "timeout" }), context);
    assert.ok(result.ok);
    assert.equal(result.request.durationMs, HOUR_MS);
    assert.equal(result.request.deleteDays, null);
  });

  test("a timeout past the server's ceiling is refused before it is sent", () => {
    const result = buildRequest(draft({ kind: "timeout", duration: { choice: 7 * DAY_MS, amount: "7", unit: "d" } }), {
      ...context,
      maxTimeoutMs: DAY_MS,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : (result.errors.duration ?? ""), /up to 1 day/);
  });

  test("a permanent ban sends no length, whatever was chosen before switching", () => {
    const result = buildRequest(draft({ kind: "ban", banLength: "permanent" }), context);
    assert.ok(result.ok);
    assert.equal(result.request.durationMs, null);
    assert.equal(result.request.deleteDays, 3);
  });

  test("a temporary ban sends its length and is checked against the ban ceiling", () => {
    const ok = buildRequest(draft({ kind: "ban", banLength: "temporary", duration: { choice: 7 * DAY_MS, amount: "7", unit: "d" } }), context);
    assert.ok(ok.ok);
    assert.equal(ok.request.durationMs, 7 * DAY_MS);

    const tooLong = buildRequest(
      draft({ kind: "ban", banLength: "temporary", duration: { choice: "custom", amount: "31", unit: "d" } }),
      context,
    );
    assert.equal(tooLong.ok, false);
  });

  test("reports a bad reason and a bad length together", () => {
    const result = buildRequest(draft({ kind: "timeout", duration: { choice: "custom", amount: "", unit: "m" } }), {
      ...context,
      requireReason: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.reason);
      assert.ok(result.errors.duration);
    }
  });

  test("the reason limit matches the counter", () => {
    assert.equal(reasonProblem("x".repeat(500), false), null);
    assert.notEqual(reasonProblem("x".repeat(501), false), null);
  });
});

describe("consequences", () => {
  const base = { dmOnAction: false, banLength: "permanent" as const, deleteDays: 0, until: null };

  test("a kick says they can come back", () => {
    assert.deepEqual(consequences({ ...base, kind: "kick" }), [
      "They will be removed from the server and can rejoin with a new invite.",
    ]);
  });

  test("a permanent ban says they stay out until unbanned", () => {
    assert.match(consequences({ ...base, kind: "ban" })[0]!, /until unbanned/);
  });

  test("a temporary ban names when it lifts", () => {
    assert.match(
      consequences({ ...base, kind: "ban", banLength: "temporary", until: "Oct 17, 2026, 12:00 PM UTC" })[0]!,
      /until Oct 17, 2026, 12:00 PM UTC/,
    );
  });

  test("message deletion is mentioned only when some will be deleted", () => {
    assert.equal(consequences({ ...base, kind: "ban", deleteDays: 0 }).length, 1);
    assert.match(consequences({ ...base, kind: "ban", deleteDays: 1 })[1]!, /previous 24 hours/);
    assert.match(consequences({ ...base, kind: "ban", deleteDays: 7 })[1]!, /previous 7 days/);
  });

  test("the direct message line appears only when the server sends one", () => {
    assert.ok(!consequences({ ...base, kind: "warn" }).some((line) => /direct message/.test(line)));
    assert.ok(consequences({ ...base, kind: "warn", dmOnAction: true }).some((line) => /direct message/.test(line)));
  });

  test("says the member also sees the messages that were attached", () => {
    const line = (messageCount: number) => consequences({ ...base, kind: "warn", dmOnAction: true, messageCount }).find((entry) => /direct message/.test(entry));
    assert.doesNotMatch(line(0)!, /attached/);
    assert.match(line(1)!, /with the reason and the message you attached/);
    assert.match(line(3)!, /with the reason and the 3 messages you attached/);
  });
});

describe("enterKeyAction", () => {
  const key = (fields: Partial<EnterKey>): EnterKey => ({ key: "Enter", ctrlKey: false, metaKey: false, tag: "INPUT", type: "radio", ...fields });

  test("plain Enter on a radio or a length chip does not submit", () => {
    assert.equal(enterKeyAction(key({})), "block");
  });

  test("plain Enter in the custom length box does not submit", () => {
    assert.equal(enterKeyAction(key({ type: "text" })), "block");
  });

  test("Ctrl or Cmd with Enter confirms from any field", () => {
    assert.equal(enterKeyAction(key({ ctrlKey: true })), "submit");
    assert.equal(enterKeyAction(key({ metaKey: true, tag: "TEXTAREA", type: "" })), "submit");
  });

  test("Enter keeps its own meaning on buttons, selects and in the reason box", () => {
    assert.equal(enterKeyAction(key({ tag: "BUTTON", type: "" })), "default");
    assert.equal(enterKeyAction(key({ tag: "SELECT", type: "" })), "default");
    assert.equal(enterKeyAction(key({ tag: "TEXTAREA", type: "" })), "default");
    assert.equal(enterKeyAction(key({ type: "submit" })), "default");
  });

  test("other keys, Space and arrows included, are left alone", () => {
    for (const name of [" ", "ArrowRight", "ArrowDown", "Tab"]) assert.equal(enterKeyAction(key({ key: name })), "default", name);
  });
});

describe("character counter announcements", () => {
  test("says nothing while there is room", () => {
    assert.equal(counterAnnouncement(10, 500), "");
  });

  test("gives the characters left once near the limit, in the singular for one", () => {
    assert.equal(counterAnnouncement(450, 500), "50 characters left");
    assert.equal(counterAnnouncement(9, 10), "1 character left");
  });

  test("says when the limit is reached", () => {
    assert.equal(counterAnnouncement(500, 500), "Limit reached");
  });
});

describe("confirmationProblem", () => {
  test("asks for a reason when one is required and only spaces were typed", () => {
    assert.match(confirmationProblem(true, "   ", false, "") ?? "", /reason/);
  });

  test("asks for the confirmation word when it is wrong", () => {
    assert.match(confirmationProblem(false, "", true, "purg") ?? "", /Type purge/);
    assert.equal(confirmationProblem(false, "", true, " PURGE "), null);
  });

  test("names the reason first when both are missing", () => {
    assert.match(confirmationProblem(true, "", true, "") ?? "", /reason/);
  });

  test("is null when everything needed is there", () => {
    assert.equal(confirmationProblem(true, "spam", false, ""), null);
    assert.equal(confirmationProblem(false, "", false, ""), null);
  });
});

describe("reading replies", () => {
  test("accepts a full context, with no actions switched off when the bot does not say", () => {
    assert.deepEqual(readContext(context), { ...context, disabledActions: [], reasonPresets: [] });
  });

  test("keeps only real action names from the switched-off list", () => {
    assert.deepEqual(readContext({ ...context, disabledActions: ["kick", "nuke", 3, "ban"] })?.disabledActions, ["kick", "ban"]);
    assert.deepEqual(readContext({ ...context, disabledActions: "kick" })?.disabledActions, []);
  });

  test("fills fields an older bot leaves out", () => {
    const read = readContext({ moduleEnabled: true });
    assert.ok(read);
    assert.equal(read.defaultTimeoutMs, 10 * MINUTE_MS);
    assert.equal(read.maxTimeoutMs, DISCORD_TIMEOUT_MAX_MS);
    assert.equal(read.requireReason, false);
  });

  test("refuses something that is not a context", () => {
    assert.equal(readContext(null), null);
    assert.equal(readContext([]), null);
    assert.equal(readContext({ error: "nope" }), null);
  });

  test("reads the case number and drops empty notes", () => {
    assert.deepEqual(readResult({ caseNumber: 61, notes: ["The direct message could not be delivered.", " ", 4] }), {
      caseNumber: 61,
      notes: ["The direct message could not be delivered."],
    });
  });

  test("falls back to the infraction's case number, or none", () => {
    assert.equal(readResult({ infraction: { caseNumber: 9 } }).caseNumber, 9);
    assert.deepEqual(readResult(null), { caseNumber: null, notes: [] });
  });
});

describe("Discord's word on where a member stands", () => {
  const clear: MemberState = { inServer: true, banned: false, timedOut: false, timeoutUntil: null };

  test("a ban Discord holds wins over a record that lost its ban case, so Unban is offered", () => {
    const record = { user: { inServer: false }, infractions: [entry("ban", { voided: { at: "2026-10-09T13:00:00Z", by: ref("2"), reason: "mistake" } })] };
    assert.equal(memberState(record, NOW).banned, false);
    const state = memberState(record, NOW, { inServer: false, banned: true, timedOutUntil: null });
    assert.equal(state.banned, true);
    const kinds = actionOptions("owner", state).map((option) => option.kind);
    assert.ok(kinds.includes("unban"));
    assert.ok(!kinds.includes("ban"));
  });

  test("when Discord could not be asked about a ban, the record decides", () => {
    const record = { user: { inServer: false }, infractions: [entry("ban")] };
    assert.equal(memberState(record, NOW, { inServer: false, banned: null, timedOutUntil: null }).banned, true);
  });

  test("the timeout end comes from Discord when it says one", () => {
    const until = "2026-10-12T12:00:00.000Z";
    const state = memberState({ user: { inServer: true }, infractions: [] }, NOW, { inServer: true, banned: false, timedOutUntil: until });
    assert.deepEqual(state, { inServer: true, banned: false, timedOut: true, timeoutUntil: until });
  });

  test("an action the bot would refuse stays listed, greyed with the bot's reason", () => {
    const blocked = { warn: "The server owner can't be actioned", timeout: "The server owner can't be actioned" };
    const options = actionOptions("mod", clear, [], blocked);
    assert.deepEqual(options.map((option) => [option.kind, option.unavailable]), [
      ["warn", "The server owner can't be actioned"],
      ["timeout", "The server owner can't be actioned"],
    ]);
  });

  test("a malformed answer reads as none, and stray keys are dropped", () => {
    assert.equal(readStanding(null), null);
    assert.equal(readStanding({ banned: true }), null);
    assert.deepEqual(readStanding({ inServer: true, banned: "yes", timedOutUntil: "soon", blocked: { kick: "Their top role is level with or above yours", nuke: "x", ban: 3 } }), {
      inServer: true,
      banned: null,
      timedOutUntil: null,
      blocked: { kick: "Their top role is level with or above yours" },
    });
  });
});

describe("changing a running timeout", () => {
  test("has its own title, button and toast", () => {
    assert.equal(actionTitle("timeout", "ToxicTuna", true), "Change ToxicTuna’s timeout");
    assert.equal(confirmLabel("timeout", "ToxicTuna", true), "Change ToxicTuna’s timeout");
    assert.equal(successTitle("timeout", "ToxicTuna", 200, true), "Changed ToxicTuna’s timeout. Case #200.");
    assert.equal(actionTitle("timeout", "ToxicTuna"), "Time out ToxicTuna");
  });

  test("opens with no length picked, and will not send until one is", () => {
    const draft = unchosenDuration();
    assert.equal(draftMs(draft), null);
    assert.match(durationProblem(draft, DISCORD_TIMEOUT_MAX_MS, "timeout") ?? "", /Choose how long the new timeout lasts/);
  });

  test("warns only when the new end comes before the current one", () => {
    const current = "2026-10-18T16:34:00.000Z";
    assert.match(earlierEndWarning(current, endsAt(HOUR_MS, NOW), "Oct 18, 04:34 PM UTC") ?? "", /ends the timeout sooner/);
    assert.equal(earlierEndWarning(current, endsAt(9 * DAY_MS, NOW), "Oct 18"), null);
    assert.equal(earlierEndWarning(current, null, "Oct 18"), null);
  });

  test("says the running timeout is replaced", () => {
    const lines = consequences({ kind: "timeout", dmOnAction: false, banLength: "permanent", deleteDays: 0, until: "Oct 10, 2026, 01:00 PM UTC", replacing: "Oct 18, 2026, 04:34 PM UTC" });
    assert.match(lines[0]!, /running until Oct 18, 2026, 04:34 PM UTC is replaced/);
  });
});

describe("deleting the attached messages with the action", () => {
  const draft = (over: Partial<ActionDraft> = {}): ActionDraft => ({
    kind: "warn",
    reason: "",
    duration: unchosenDuration(),
    banLength: "permanent",
    deleteDays: 0,
    evidence: [{ channelId: "100000000000000001", messageId: "100000000000000002" }],
    ...over,
  });

  test("is offered for a warning, timeout, kick and ban that have a message attached", () => {
    for (const kind of ["warn", "timeout", "kick", "ban"] as const) {
      assert.equal(offersDeletion(kind, 1), true, kind);
      assert.equal(offersDeletion(kind, 0), false, kind);
    }
    assert.equal(offersDeletion("timeout-clear", 2), false);
    assert.equal(offersDeletion("unban", 2), false);
  });

  test("is worded for one message and for several", () => {
    assert.equal(deletionChoiceText(1).label, "Also delete this message");
    assert.equal(deletionChoiceText(3).label, "Also delete these 3 messages");
    assert.match(deletionChoiceText(2).note, /attached as evidence, in the channels they were sent in/);
    assert.match(deletionChoiceText(2).note, /the action still goes through and the result says which messages could not be deleted/);
  });

  test("is sent only when switched on, for an action that takes it, with messages attached", () => {
    const send = (over: Partial<ActionDraft>, kind: ActionDraft["kind"] = "warn") => {
      const check = buildRequest(draft({ kind, duration: kind === "timeout" ? { choice: 10 * MINUTE_MS, ...splitMs(10 * MINUTE_MS) } : unchosenDuration(), ...over }), context);
      assert.ok(check.ok);
      return check.request;
    };
    assert.equal(send({ deleteMessages: true }).deleteMessages, true);
    assert.equal("deleteMessages" in send({ deleteMessages: false }), false);
    assert.equal("deleteMessages" in send({}), false);
    assert.equal("deleteMessages" in send({ deleteMessages: true, evidence: [] }), false);
    assert.equal(send({ deleteMessages: true }, "kick").deleteMessages, true);
    assert.equal(send({ deleteMessages: true }, "timeout").deleteMessages, true);
    assert.equal("deleteMessages" in send({ deleteMessages: true }, "unban"), false);
  });

  test("says in the summary that the messages will be deleted", () => {
    const base = { kind: "warn" as const, dmOnAction: false, banLength: "permanent" as const, deleteDays: 0, until: null };
    assert.ok(!consequences({ ...base, deleteCount: 0 }).some((line) => /deleted from Discord/.test(line)));
    assert.ok(consequences({ ...base, deleteCount: 1 }).includes("The message you attached will be deleted from Discord once this goes through."));
    assert.ok(consequences({ ...base, deleteCount: 4 }).includes("The 4 messages you attached will be deleted from Discord once this goes through."));
  });

  test("starts from the server's setting, and off when an older bot does not send one", () => {
    assert.equal(readContext({ ...context, deleteMessagesByDefault: true })?.deleteMessagesByDefault, true);
    assert.equal(readContext({ ...context, deleteMessagesByDefault: "yes" })?.deleteMessagesByDefault, false);
    assert.equal(readContext({ moduleEnabled: true })?.deleteMessagesByDefault, false);
  });
});
