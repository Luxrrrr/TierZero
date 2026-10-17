import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MASS_ACTION_LIMIT, type LockableChannelDto } from "@tier0/core";
import {
  buildMassRequest,
  fromLocalInput,
  groupChannels,
  idsSummary,
  jobProgressText,
  lockAllTargets,
  lockBody,
  lockConfirmText,
  massConfirmLabel,
  parseIds,
  previewSummary,
  quickWindow,
  readJob,
  readLockResult,
  readPreview,
  requestKey,
  toLocalInput,
  type MassDraft,
} from "../lib/mod-raid.ts";

const A = "112233445566778899";
const B = "998877665544332211";
const C = "123456789012345678";

describe("parseIds", () => {
  test("reads ids split by spaces, commas and new lines", () => {
    assert.deepEqual(parseIds(`${A}, ${B}\n${C}`).ids, [A, B, C]);
  });

  test("reads mentions as Discord copies them", () => {
    assert.deepEqual(parseIds(`<@${A}> <@!${B}>`).ids, [A, B]);
  });

  test("keeps each id once and counts the repeats", () => {
    const parsed = parseIds(`${A} ${A} <@${A}>`);
    assert.deepEqual(parsed.ids, [A]);
    assert.equal(parsed.duplicates, 2);
  });

  test("sets aside pieces that are not ids", () => {
    const parsed = parseIds(`${A} xXSniperXx 12345 <@abc>`);
    assert.deepEqual(parsed.ids, [A]);
    assert.deepEqual(parsed.invalid, ["xXSniperXx", "12345", "<@abc>"]);
  });

  test("an id needs 17 to 20 digits", () => {
    assert.deepEqual(parseIds("1234567890123456 123456789012345678901").ids, []);
    assert.deepEqual(parseIds("12345678901234567 12345678901234567890").ids, ["12345678901234567", "12345678901234567890"]);
  });

  test("summarises what was read", () => {
    assert.equal(idsSummary(parseIds(A)), "1 user ID read.");
    assert.equal(idsSummary(parseIds(`${A} ${A} nope ${B}`)), "2 user IDs read, 1 repeated, 1 not recognised.");
  });
});

describe("local times", () => {
  test("a datetime-local value round-trips through ISO", () => {
    const date = new Date(2026, 9, 17, 21, 5);
    const local = toLocalInput(date);
    assert.match(local, /^2026-10-17T21:05$/);
    assert.equal(fromLocalInput(local), date.toISOString());
  });

  test("anything that is not a time reads as none", () => {
    assert.equal(fromLocalInput(""), null);
    assert.equal(fromLocalInput("yesterday"), null);
    assert.equal(fromLocalInput("2026-13-45T99:99"), null);
  });

  test("a quick pick ends now and starts that long before", () => {
    const now = new Date(2026, 9, 17, 12, 0);
    assert.deepEqual(quickWindow(10 * 60_000, now), { after: "2026-10-17T11:50", before: "2026-10-17T12:00" });
  });
});

const base: MassDraft = { action: "ban", target: "ids", idsText: "", joinedAfter: "", joinedBefore: "", reason: "", deleteDays: 1 };
const NOW = new Date(2026, 9, 17, 12, 0);

describe("buildMassRequest", () => {
  test("needs at least one id", () => {
    const check = buildMassRequest(base, NOW);
    assert.equal(check.ok, false);
    assert.equal(!check.ok && check.field, "ids");
  });

  test("refuses more ids than one mass action takes", () => {
    const many = Array.from({ length: MASS_ACTION_LIMIT + 1 }, (_, index) => String(100000000000000000n + BigInt(index))).join(" ");
    const check = buildMassRequest({ ...base, idsText: many }, NOW);
    assert.equal(check.ok, false);
    assert.match(!check.ok ? check.error : "", /up to 200/);
  });

  test("takes exactly the limit", () => {
    const many = Array.from({ length: MASS_ACTION_LIMIT }, (_, index) => String(100000000000000000n + BigInt(index))).join("\n");
    assert.equal(buildMassRequest({ ...base, idsText: many }, NOW).ok, true);
  });

  test("builds a ban with its message deletion and no empty reason", () => {
    const check = buildMassRequest({ ...base, idsText: `${A} ${B}`, deleteDays: 9 }, NOW);
    assert.deepEqual(check, { ok: true, request: { action: "ban", reason: null, deleteDays: 7, ids: [A, B] } });
  });

  test("a kick sends no message deletion", () => {
    const check = buildMassRequest({ ...base, action: "kick", idsText: A, reason: "  Raid accounts  " }, NOW);
    assert.deepEqual(check, { ok: true, request: { action: "kick", reason: "Raid accounts", ids: [A] } });
  });

  test("a join window needs a start that has passed", () => {
    assert.equal(buildMassRequest({ ...base, target: "joined" }, NOW).ok, false);
    const future = buildMassRequest({ ...base, target: "joined", joinedAfter: "2026-10-17T13:00" }, NOW);
    assert.equal(!future.ok && future.field, "after");
  });

  test("a join window's end must come after its start", () => {
    const check = buildMassRequest({ ...base, target: "joined", joinedAfter: "2026-10-17T11:00", joinedBefore: "2026-10-17T10:00" }, NOW);
    assert.equal(!check.ok && check.field, "before");
  });

  test("a join window with no end runs to now", () => {
    const check = buildMassRequest({ ...base, target: "joined", joinedAfter: "2026-10-17T11:50" }, NOW);
    assert.ok(check.ok);
    assert.equal(check.request.joinedAfter, new Date(2026, 9, 17, 11, 50).toISOString());
    assert.equal("joinedBefore" in check.request, false);
    assert.equal("ids" in check.request, false);
  });
});

describe("a preview stands only for the inputs it was made from", () => {
  const key = (draft: Partial<MassDraft>) => {
    const check = buildMassRequest({ ...base, idsText: A, ...draft }, NOW);
    assert.ok(check.ok);
    return requestKey(check.request);
  };

  test("the same inputs give the same key", () => {
    assert.equal(key({}), key({}));
    assert.equal(key({ idsText: `${A}\n` }), key({ idsText: A }));
  });

  test("any change that reaches the request changes the key", () => {
    assert.notEqual(key({}), key({ action: "kick" }));
    assert.notEqual(key({}), key({ idsText: `${A} ${B}` }));
    assert.notEqual(key({}), key({ reason: "raid" }));
    assert.notEqual(key({}), key({ deleteDays: 3 }));
  });
});

describe("wording", () => {
  test("the preview counts both sides", () => {
    assert.equal(previewSummary({ action: "ban", count: 12, skipped: 3 }), "12 will be banned, 3 left alone");
    assert.equal(previewSummary({ action: "kick", count: 1, skipped: 0 }), "1 will be kicked");
  });

  test("the hold button names the count", () => {
    assert.equal(massConfirmLabel("ban", 12), "Hold to ban 12 members");
    assert.equal(massConfirmLabel("kick", 1), "Hold to kick 1 member");
  });

  test("progress reads as done of total, then the result", () => {
    assert.equal(jobProgressText({ action: "ban", status: "running", total: 52, done: 40, failed: 2 }), "40 of 52 done, 2 failed.");
    assert.equal(jobProgressText({ action: "kick", status: "done", total: 5, done: 5, failed: 0 }), "Finished: 5 kicked.");
    assert.equal(jobProgressText({ action: "ban", status: "done", total: 5, done: 5, failed: 1 }), "Finished: 4 banned, 1 failed.");
  });
});

describe("reading replies", () => {
  test("a preview without targets or a count is refused", () => {
    assert.equal(readPreview({ action: "ban", count: 1 }), null);
    assert.equal(readPreview({ action: "nuke", targets: [], count: 0 }), null);
    assert.deepEqual(readPreview({ action: "kick", targets: [], count: 0 }), { action: "kick", targets: [], count: 0, skipped: 0, token: "" });
  });

  test("a job needs an id and a known status", () => {
    assert.equal(readJob({ id: 4, status: "running" }), null);
    assert.equal(readJob({ id: "j1", status: "paused" }), null);
    assert.deepEqual(readJob({ id: "j1", action: "kick", status: "running", total: 3, done: "1", failures: ["x", 2] }), {
      id: "j1",
      action: "kick",
      status: "running",
      total: 3,
      done: 0,
      failed: 0,
      failures: ["x"],
    });
  });

  test("a lock reply carries the count, the failures and the new status", () => {
    const status = { moduleEnabled: true, locked: [], channels: [], joinAlert: { enabled: false, joins: 10, seconds: 10, lockdown: false }, recentJoins: 0, canManageChannels: true };
    assert.deepEqual(readLockResult({ locked: 3, failed: ["#voice-lobby: Missing Permissions", ""], status }, "locked"), {
      changed: 3,
      failed: ["#voice-lobby: Missing Permissions"],
      status,
    });
    assert.deepEqual(readLockResult({ unlocked: 2 }, "unlocked"), { changed: 2, failed: [], status: null });
    assert.deepEqual(readLockResult(null, "locked"), { changed: 0, failed: [], status: null });
  });
});

describe("lockdown", () => {
  const channel = (id: string, fields: Partial<LockableChannelDto> = {}): LockableChannelDto => ({
    id,
    name: `chan-${id}`,
    parent: null,
    locked: false,
    exempt: false,
    ...fields,
  });

  test("lock all leaves out exempt and already locked channels", () => {
    const targets = lockAllTargets([channel("1"), channel("2", { exempt: true }), channel("3", { locked: true }), channel("4")]);
    assert.deepEqual(
      targets.map((entry) => entry.id),
      ["1", "4"],
    );
  });

  test("the request sends no empty reason and the chosen length", () => {
    assert.deepEqual(lockBody("all", "  ", "none"), { channels: "all", reason: null, durationMs: null });
    assert.deepEqual(lockBody(["1"], "Raid", "1h"), { channels: ["1"], reason: "Raid", durationMs: 3_600_000 });
    assert.equal(lockBody(["1"], "", "made-up").durationMs, null);
  });

  test("the confirmation names the count and what members lose", () => {
    assert.match(lockConfirmText(1, "none"), /send messages in 1 channel until someone unlocks them/);
    assert.match(lockConfirmText(5, "15m"), /5 channels for 15 minutes, then they unlock on their own/);
  });

  test("the picker groups channels under their category in the order given", () => {
    const groups = groupChannels([channel("1", { parent: "Lobby" }), channel("2"), channel("3", { parent: "Lobby" })]);
    assert.deepEqual(
      groups.map((group) => [group.parent, group.channels.map((entry) => entry.id)]),
      [
        ["Lobby", ["1", "3"]],
        [null, ["2"]],
      ],
    );
  });
});
