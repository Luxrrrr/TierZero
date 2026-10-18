import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  acquireWait,
  heldWaits,
  inboxVersion,
  notifyTicket,
  pendingWaits,
  ticketDetailVersion,
  ticketVersion,
  waitForInbox,
  waitForTicket,
  WAITS_PER_VIEWER,
} from "../dist/live.js";

const GUILD = "100000000000000031";
const OTHER_GUILD = "100000000000000032";

// Ticket ids are unique per test so the shared counters never carry over between them.
let next = 5_000_000;
const fresh = () => (next += 1);

describe("versions", () => {
  test("only grow, per ticket and per server", () => {
    const a = fresh();
    const b = fresh();
    const start = inboxVersion(GUILD);
    notifyTicket(GUILD, a, "message");
    const first = ticketVersion(a);
    notifyTicket(GUILD, b, "message");
    notifyTicket(GUILD, a, "message");
    assert.ok(ticketVersion(a) > first);
    assert.ok(ticketVersion(b) > first);
    assert.ok(inboxVersion(GUILD) > start);
    assert.equal(inboxVersion(GUILD), ticketVersion(a));
  });

  test("a message moves the ticket, a detail change also moves the detail version, activity moves only the inbox", () => {
    const id = fresh();
    notifyTicket(GUILD, id, "message");
    const afterMessage = { ticket: ticketVersion(id), detail: ticketDetailVersion(id) };
    assert.equal(afterMessage.detail, 0);
    notifyTicket(GUILD, id, "detail");
    assert.ok(ticketVersion(id) > afterMessage.ticket);
    assert.equal(ticketDetailVersion(id), ticketVersion(id));
    const before = ticketVersion(id);
    const inbox = inboxVersion(GUILD);
    notifyTicket(GUILD, id, "activity");
    assert.equal(ticketVersion(id), before);
    assert.ok(inboxVersion(GUILD) > inbox);
  });

  test("another server's changes do not move this server's inbox", () => {
    const before = inboxVersion(GUILD);
    notifyTicket(OTHER_GUILD, fresh(), "message");
    assert.equal(inboxVersion(GUILD), before);
  });
});

describe("waiting", () => {
  test("a change after the version seen wakes the wait with the new version", async () => {
    const id = fresh();
    const seen = ticketVersion(id);
    const waiting = waitForTicket(GUILD, id, seen, 5_000);
    setTimeout(() => notifyTicket(GUILD, id, "message"), 20);
    const version = await waiting;
    assert.ok(version > seen);
    assert.equal(version, ticketVersion(id));
    assert.deepEqual(pendingWaits(), { tickets: 0, inboxes: 0 });
  });

  test("a change between the poll and the wait is not missed", async () => {
    const id = fresh();
    const seen = ticketVersion(id);
    notifyTicket(GUILD, id, "message");
    const started = Date.now();
    const version = await waitForTicket(GUILD, id, seen, 5_000);
    assert.ok(version > seen);
    assert.ok(Date.now() - started < 200);
  });

  test("times out with the version unchanged", async () => {
    const id = fresh();
    const seen = ticketVersion(id);
    const started = Date.now();
    assert.equal(await waitForTicket(GUILD, id, seen, 60), seen);
    assert.ok(Date.now() - started >= 50);
    assert.equal(pendingWaits().tickets, 0);
  });

  test("an abort ends the wait at once and leaves nothing behind", async () => {
    const id = fresh();
    const controller = new AbortController();
    const waiting = waitForTicket(GUILD, id, ticketVersion(id), 5_000, controller.signal);
    assert.equal(pendingWaits().tickets, 1);
    controller.abort();
    await waiting;
    assert.equal(pendingWaits().tickets, 0);
    assert.equal(await waitForTicket(GUILD, id, ticketVersion(id), 5_000, controller.signal), ticketVersion(id));
  });

  test("activity does not wake a ticket's wait but does wake the inbox", async () => {
    const id = fresh();
    const seen = ticketVersion(id);
    const inbox = inboxVersion(GUILD);
    const ticketWait = waitForTicket(GUILD, id, seen, 80);
    const inboxWait = waitForInbox(GUILD, inbox, 5_000);
    notifyTicket(GUILD, id, "activity");
    assert.ok((await inboxWait) > inbox);
    assert.equal(await ticketWait, seen);
  });

  test("one change wakes every waiter on the ticket", async () => {
    const id = fresh();
    const seen = ticketVersion(id);
    const all = Promise.all([waitForTicket(GUILD, id, seen, 5_000), waitForTicket(GUILD, id, seen, 5_000), waitForInbox(GUILD, inboxVersion(GUILD), 5_000)]);
    notifyTicket(GUILD, id, "detail");
    const versions = await all;
    assert.ok(versions.every((version) => version > seen));
  });
});

describe("places", () => {
  test("a viewer has a fixed number, and giving one back frees it once", () => {
    const g = "100000000000000041";
    const viewer = "500000000000000041";
    const releases = Array.from({ length: WAITS_PER_VIEWER }, () => acquireWait(g, viewer)!);
    assert.ok(releases.every((release) => typeof release === "function"));
    assert.equal(acquireWait(g, viewer), null);
    assert.ok(acquireWait(g, "500000000000000042"));
    releases[0]!();
    releases[0]!();
    assert.equal(heldWaits(g), WAITS_PER_VIEWER);
    const again = acquireWait(g, viewer);
    assert.ok(again);
    assert.equal(acquireWait(g, viewer), null);
    again!();
    for (const release of releases) release();
  });

  test("a server has a cap of its own", () => {
    const g = "100000000000000043";
    const held = [acquireWait(g, "1", { guild: 2 }), acquireWait(g, "2", { guild: 2 })];
    assert.ok(held.every(Boolean));
    assert.equal(acquireWait(g, "3", { guild: 2 }), null);
    held[0]!();
    assert.ok(acquireWait(g, "3", { guild: 2 }));
  });
});
