import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ada, grace, mod, open, prisma, setup, tickets } from "./ticket-world.ts";
import { GUILD, message } from "./fake-discord.ts";

/** What the dashboard's long polls hear from the module: each change to a ticket moves the right version. */

const { inboxVersion, ticketDetailVersion, ticketVersion, waitForInbox, waitForTicket } = mod;
const actor = { userId: grace.id, name: "Grace", avatarUrl: null };

describe("changes the dashboard hears about", () => {
  test("a message in Discord wakes a wait on its ticket before the slower bookkeeping is done", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const seen = ticketVersion(row.id);
    const inbox = inboxVersion(GUILD);
    const waiting = waitForTicket(GUILD, row.id, seen, 5_000);
    const started = Date.now();
    await tickets.events!.messageCreate!(message(ch.id, ada, "anyone there?") as never, w.ctx);
    assert.ok((await waiting) > seen);
    assert.ok(Date.now() - started < 1_000);
    assert.ok(inboxVersion(GUILD) > inbox);
    assert.equal((await prisma.ticketMessage.count({ where: { ticketId: row.id, content: "anyone there?" } })), 1, "the wait was woken by a stored row");
  });

  test("an edit and a delete wake it too", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const sent = message(ch.id, ada, "first");
    await tickets.events!.messageCreate!(sent as never, w.ctx);
    let seen = ticketVersion(row.id);
    await tickets.events!.messageUpdate!({} as never, { ...sent, content: "second", editedAt: new Date() } as never, w.ctx);
    assert.ok(ticketVersion(row.id) > seen);
    seen = ticketVersion(row.id);
    await tickets.events!.messageDelete!(sent as never, w.ctx);
    assert.ok(ticketVersion(row.id) > seen);
  });

  test("a claim, a priority change and a note move the detail version", async () => {
    const w = setup();
    const { row } = await open(w);
    const steps: [string, () => Promise<unknown>][] = [
      ["claim", () => mod.claimTicket(w.ctx, row.id, actor)],
      ["priority", () => mod.setTicketPriority(w.ctx, row.id, "high", actor)],
      ["note", () => mod.addTicketNote(w.ctx, row.id, "Called them back", actor)],
    ];
    for (const [name, run] of steps) {
      const before = ticketDetailVersion(row.id);
      await run();
      // The event row is written before the version moves; a lookup of the server may still be on its way.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(ticketDetailVersion(row.id) > before, name);
    }
  });

  test("closing and reopening move it", async () => {
    const w = setup({ general: { closeBehaviour: "archive", reopen: true } });
    const { row } = await open(w);
    let before = ticketDetailVersion(row.id);
    await mod.closeTicketAs(w.ctx, row.id, { reason: "Done" }, actor);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(ticketDetailVersion(row.id) > before);
    before = ticketDetailVersion(row.id);
    await mod.reopenTicket(w.ctx, row.id, actor);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(ticketDetailVersion(row.id) > before);
  });

  test("opening a ticket wakes the server's inbox", async () => {
    const w = setup();
    const inbox = inboxVersion(GUILD);
    const waiting = waitForInbox(GUILD, inbox, 5_000);
    await open(w);
    assert.ok((await waiting) > inbox);
  });

  test("a dashboard reply wakes the ticket", async () => {
    const w = setup({}, {});
    const { row } = await open(w);
    const seen = ticketVersion(row.id);
    await mod.replyToTicket(w.ctx, row.id, "Looking now", actor);
    assert.ok(ticketVersion(row.id) > seen);
  });
});
