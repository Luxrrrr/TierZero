import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { TicketMessageDto } from "@tier0/shared-tickets";
import { listPath, messagesPath } from "../lib/tickets-client.ts";
import {
  FALLBACK_AFTER_FAILURES,
  QUICK_LIMIT,
  RETRY_MAX_MS,
  retryDelay,
  startLongPoll,
  WAIT_SECONDS,
  type PollOutcome,
} from "../lib/ticket-longpoll.ts";
import { discardPending, isPendingMessage, mergeArrivals, pendingMessage, settlePending } from "../lib/ticket-optimistic.ts";
import { ticketProxyClass, ticketProxyTimeoutMs, ticketTarget } from "../lib/tickets-proxy.ts";

const VIEWER = "500000000000000001";
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for something to happen rather than guessing how long a slow machine needs. */
async function until(done: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await tick(5);
}

describe("retryDelay", () => {
  test("backs off 1 s, 2 s, 4 s, 8 s and stops at 10 s", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(retryDelay), [0, 1000, 2000, 4000, 8000, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    assert.equal(RETRY_MAX_MS, 10_000);
  });
});

/** A poll that answers from a script and records what it was asked. */
function scripted(outcomes: (PollOutcome | (() => Promise<PollOutcome>))[]) {
  const asked: { wait: number; aborted: () => boolean }[] = [];
  let index = 0;
  return {
    asked,
    poll: async ({ signal, wait }: { signal: AbortSignal; wait: number }) => {
      asked.push({ wait, aborted: () => signal.aborted });
      const next = outcomes[Math.min(index, outcomes.length - 1)]!;
      index += 1;
      if (typeof next === "function") return next();
      await tick(1);
      return next;
    },
  };
}

const forever = () => new Promise<PollOutcome>(() => undefined);

describe("startLongPoll", () => {
  test("asks again at once after every answer, holding each request", async () => {
    const script = scripted(["ok"]);
    const loop = startLongPoll({ poll: script.poll, visible: () => true, intervalMs: 5, delay: () => 1 });
    await until(() => script.asked.length > 3);
    loop.stop();
    assert.ok(script.asked.length > 3);
    assert.ok(script.asked.every((request) => request.wait === WAIT_SECONDS));
  });

  test("does nothing while hidden and asks straight away when shown", async () => {
    let visible = false;
    const script = scripted([forever]);
    const loop = startLongPoll({ poll: script.poll, visible: () => visible, intervalMs: 5 });
    await tick(30);
    assert.equal(script.asked.length, 0);
    visible = true;
    loop.visibilityChanged();
    await until(() => script.asked.length === 1);
    assert.equal(script.asked.length, 1);
    loop.stop();
  });

  test("hiding aborts the held request, and showing asks again", async () => {
    let visible = true;
    const script = scripted([]);
    // This request answers "aborted" when its signal fires, as the real one does.
    const loop = startLongPoll({
      visible: () => visible,
      intervalMs: 5,
      poll: ({ signal, wait }) =>
        new Promise<PollOutcome>((resolve) => {
          script.asked.push({ wait, aborted: () => signal.aborted });
          signal.addEventListener("abort", () => resolve("aborted"), { once: true });
        }),
    });
    await until(() => script.asked.length === 1);
    assert.equal(script.asked.length, 1);
    visible = false;
    loop.visibilityChanged();
    await tick(40);
    assert.equal(script.asked[0]!.aborted(), true);
    assert.equal(script.asked.length, 1, "nothing is asked while hidden");
    visible = true;
    loop.visibilityChanged();
    await until(() => script.asked.length === 2);
    assert.equal(script.asked.length, 2);
    loop.stop();
    assert.equal(script.asked[1]!.aborted(), true, "stopping aborts the request in flight");
  });

  test("while hidden it can still ask on a slow timer, without holding", async () => {
    const script = scripted(["ok"]);
    const loop = startLongPoll({ poll: script.poll, visible: () => false, intervalMs: 5, hiddenIntervalMs: () => 10 });
    await until(() => script.asked.length >= 2);
    loop.stop();
    assert.ok(script.asked.length >= 2 && script.asked.length < 40);
    assert.ok(script.asked.every((request) => request.wait === 0));
  });

  test("a failure backs off before asking again, and a success resets the count", async () => {
    const delays: number[] = [];
    const script = scripted(["error", "error", "ok", "error"]);
    const loop = startLongPoll({
      poll: script.poll,
      visible: () => true,
      intervalMs: 5,
      delay: (failures) => {
        delays.push(failures);
        return 1;
      },
    });
    await until(() => delays.length >= 3);
    loop.stop();
    assert.deepEqual(delays.slice(0, 3), [1, 2, 1]);
  });

  test("keeps failing, then falls back to asking on a timer without holding", async () => {
    const modes: string[] = [];
    const script = scripted(["error"]);
    const loop = startLongPoll({ poll: script.poll, visible: () => true, intervalMs: 5, delay: () => 1, onMode: (mode) => modes.push(mode) });
    await until(() => script.asked.some((request) => request.wait === 0));
    loop.stop();
    assert.equal(loop.mode(), "interval");
    assert.deepEqual(modes, ["interval"]);
    const held = script.asked.filter((request) => request.wait > 0).length;
    assert.equal(held, FALLBACK_AFTER_FAILURES + 1);
    assert.ok(script.asked.some((request) => request.wait === 0));
  });

  test("a bot that answers every held request at once is given up on too", async () => {
    const script = scripted(["ok"]);
    const loop = startLongPoll({ poll: script.poll, visible: () => true, intervalMs: 5, delay: () => 1 });
    await until(() => script.asked.some((request) => request.wait === 0));
    loop.stop();
    assert.equal(loop.mode(), "interval");
    assert.equal(script.asked.filter((request) => request.wait > 0).length, QUICK_LIMIT);
  });

  test("stop ends the loop and an answer of stop does too", async () => {
    const script = scripted(["stop"]);
    const loop = startLongPoll({ poll: script.poll, visible: () => true, intervalMs: 5 });
    await until(() => script.asked.length >= 1);
    await tick(40);
    assert.equal(script.asked.length, 1);
    loop.stop();
  });
});

describe("paths", () => {
  test("a held messages read names the wait and the detail version, a plain one neither", () => {
    assert.equal(messagesPath(7, "12", "2026-01-01T00:00:00.000Z", { wait: 20, version: 55 }), "items/7/messages?after=12&updatedSince=2026-01-01T00%3A00%3A00.000Z&wait=20&detailVersion=55");
    assert.equal(messagesPath(7, "12", null, { wait: 0, version: 55 }), "items/7/messages?after=12");
    assert.equal(messagesPath(7, null), "items/7/messages");
  });

  test("only the count can be held, with its version", () => {
    assert.equal(listPath("count", { afterId: 4 }, { wait: 20, version: 9 }), "count?after=4&wait=20&version=9");
    assert.equal(listPath("count", {}, { wait: 20 }), "count?wait=20");
    assert.equal(listPath("list", {}, { wait: 20, version: 9 }), "list");
  });
});

describe("what the proxy lets through", () => {
  test("wait and the versions go to the two reads that can be held and nowhere else", () => {
    const search = new URLSearchParams("wait=20&version=9&detailVersion=3&after=5");
    const count = new URLSearchParams(ticketTarget(["count"], search, VIEWER, "GET").split("?")[1]);
    assert.equal(count.get("wait"), "20");
    assert.equal(count.get("version"), "9");
    assert.equal(count.get("detailVersion"), null);
    const messages = new URLSearchParams(ticketTarget(["items", "42", "messages"], search, VIEWER, "GET").split("?")[1]);
    assert.deepEqual([messages.get("wait"), messages.get("detailVersion"), messages.get("version"), messages.get("after")], ["20", "3", null, "5"]);
    for (const path of [["list"], ["context"], ["access"], ["stats"], ["members"], ["templates"], ["items", "42"], ["items", "42", "transcript.txt"]]) {
      const query = new URLSearchParams(ticketTarget(path, search, VIEWER, "GET").split("?")[1]);
      assert.equal(query.get("wait"), null, path.join("/"));
      assert.equal(query.get("version"), null, path.join("/"));
    }
  });

  test("a wait or version that is not a whole number is dropped, and the viewer is still the signed-in user", () => {
    const target = ticketTarget(["count"], new URLSearchParams(`wait=20s&version=-1&viewer=666666666666666666`), VIEWER, "GET");
    assert.equal(target, `count?viewer=${VIEWER}`);
  });

  test("writes never carry a wait", () => {
    assert.equal(ticketTarget(["items", "42", "claim"], new URLSearchParams("wait=20"), VIEWER, "POST"), "items/42/claim");
    assert.equal(ticketProxyClass("POST", ["count"]), null);
  });

  test("only a held read gets the long timeout", () => {
    const held = new URLSearchParams("wait=20");
    assert.equal(ticketProxyTimeoutMs("GET", ["count"], held), 35_000);
    assert.equal(ticketProxyTimeoutMs("GET", ["items", "42", "messages"], held), 35_000);
    assert.equal(ticketProxyTimeoutMs("GET", ["items", "42", "messages"], new URLSearchParams("wait=900")), 35_000);
    assert.equal(ticketProxyTimeoutMs("GET", ["items", "42", "messages"], new URLSearchParams("after=3")), undefined);
    assert.equal(ticketProxyTimeoutMs("GET", ["items", "42", "messages"], new URLSearchParams("wait=0")), undefined);
    assert.equal(ticketProxyTimeoutMs("GET", ["items", "42", "messages"], new URLSearchParams("wait=soon")), undefined);
    for (const path of [["list"], ["context"], ["stats"], ["items", "42"], ["items", "42", "transcript.html"]]) {
      assert.equal(ticketProxyTimeoutMs("GET", path, held), undefined, path.join("/"));
    }
    assert.equal(ticketProxyTimeoutMs("POST", ["items", "42", "reply"], held), 60_000);
    assert.equal(ticketProxyTimeoutMs("POST", ["items", "42", "claim"], held), undefined);
  });
});

function stored(over: Partial<TicketMessageDto> = {}): TicketMessageDto {
  return {
    id: 5,
    messageId: "800000000000000001",
    author: { userId: VIEWER, name: "Grace", avatarUrl: null, isStaff: true },
    content: "On it",
    attachments: [],
    embeds: [],
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "dashboard",
    ...over,
  };
}

const draft = { token: "a1", content: "On it", replyTo: null, viewer: { userId: VIEWER, name: "You", avatarUrl: null }, at: new Date(Date.now() - 100) };

describe("a reply shown before it is stored", () => {
  test("is marked pending, last in the conversation, and quiet to the menus", () => {
    const pending = pendingMessage(draft);
    assert.equal(isPendingMessage(pending), true);
    assert.equal(isPendingMessage(stored()), false);
    const earlier = stored({ id: 4, messageId: "800000000000000000", source: "discord", createdAt: new Date(Date.now() - 5_000).toISOString() });
    assert.deepEqual(
      mergeArrivals([earlier], [pending], VIEWER).map((message) => message.messageId),
      ["800000000000000000", pending.messageId],
    );
  });

  test("the answer to the send replaces it", () => {
    const current = [pendingMessage(draft)];
    const next = settlePending(current, "a1", stored());
    assert.deepEqual(next.map((message) => message.messageId), ["800000000000000001"]);
  });

  test("the feed bringing the stored message first leaves one copy, and the answer after it adds none", () => {
    let current = [pendingMessage(draft)];
    current = mergeArrivals(current, [stored()], VIEWER);
    assert.deepEqual(current.map((message) => message.messageId), ["800000000000000001"]);
    current = settlePending(current, "a1", stored());
    assert.equal(current.length, 1);
  });

  test("the answer first and then the feed adds no copy either", () => {
    let current = settlePending([pendingMessage(draft)], "a1", stored());
    current = mergeArrivals(current, [stored()], VIEWER);
    assert.equal(current.length, 1);
  });

  test("someone else's message with the same words does not settle it", () => {
    const current = [pendingMessage(draft)];
    const other = stored({ messageId: "800000000000000002", author: { userId: "500000000000000009", name: "Linus", avatarUrl: null, isStaff: false }, source: "discord" });
    assert.equal(mergeArrivals(current, [other], VIEWER).length, 2);
  });

  test("a reply sent under the team's name still settles it, by who sent it", () => {
    const team = stored({ author: { userId: "000", name: "Support Team", avatarUrl: null, isStaff: true }, sentBy: { userId: VIEWER, name: "Grace" } });
    assert.deepEqual(mergeArrivals([pendingMessage(draft)], [team], VIEWER).map((message) => message.messageId), ["800000000000000001"]);
  });

  test("two pending replies with the same words are settled one each", () => {
    const second = pendingMessage({ ...draft, token: "a2" });
    const current = [pendingMessage(draft), second];
    const once = mergeArrivals(current, [stored()], VIEWER);
    assert.equal(once.filter(isPendingMessage).length, 1);
    const twice = mergeArrivals(once, [stored({ id: 6, messageId: "800000000000000003" })], VIEWER);
    assert.equal(twice.filter(isPendingMessage).length, 0);
    assert.equal(twice.length, 2);
  });

  test("a send that fails takes it away", () => {
    const current = [stored({ source: "discord", author: { userId: "500000000000000009", name: "Ada", avatarUrl: null, isStaff: false } }), pendingMessage(draft)];
    assert.equal(discardPending(current, "a1").length, 1);
  });

  test("a message that arrives for a conversation with nothing pending is merged as before", () => {
    const current = [stored()];
    assert.equal(mergeArrivals(current, [stored(), stored({ id: 6, messageId: "800000000000000004" })], VIEWER).length, 2);
  });
});
