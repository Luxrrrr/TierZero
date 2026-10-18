import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { TicketPanelOption, TicketTypeOption, UserRef } from "@tier0/core";
import { creatableTypes, createFailureText, createRequest, draftProblem, emptyDraft, openableTypes, withMember } from "../lib/ticket-create.ts";
import { shortcutFor, TICKET_SHORTCUTS } from "../lib/ticket-shortcuts.ts";
import { ticketProxyClass } from "../lib/tickets-proxy.ts";
import { ticketsApiPath } from "../lib/tickets-client.ts";

const type = (id: string, extra: Partial<TicketTypeOption> = {}): TicketTypeOption => ({
  id,
  name: id,
  emoji: null,
  panelId: "main",
  handled: true,
  ...extra,
});

const panel = (types: TicketTypeOption[], id = "main"): TicketPanelOption => ({ id, name: id, channelId: null, types });

const person = (n: number, inServer = true): UserRef => ({ userId: `1300000000000000${String(10 + n)}`, name: `Gamer${n}`, avatarUrl: null, inServer });

describe("creatableTypes", () => {
  test("only the types the viewer handles, and no empty panels", () => {
    const groups = creatableTypes([panel([type("a"), type("b", { handled: false })]), panel([type("c", { handled: false })], "second")]);
    assert.deepEqual(
      groups.map((group) => [group.id, group.types.map((t) => t.id)]),
      [["main", ["a"]]],
    );
  });

  test("a type with a setup problem is listed but not openable", () => {
    const groups = creatableTypes([panel([type("a", { problem: "categoryFull" }), type("b")])]);
    assert.equal(groups[0]!.types.length, 2);
    assert.deepEqual(
      openableTypes(groups).map((t) => t.id),
      ["b"],
    );
  });
});

describe("withMember", () => {
  test("adds once", () => {
    const first = withMember([], person(1));
    assert.equal(first.members.length, 1);
    assert.equal(withMember(first.members, person(1)).members.length, 1);
  });

  test("refuses someone who left the server", () => {
    const result = withMember([], person(1, false));
    assert.equal(result.members.length, 0);
    assert.match(result.problem ?? "", /not in the server/);
  });

  test("stops at ten", () => {
    let members: UserRef[] = [];
    for (let n = 0; n < 10; n++) members = withMember(members, person(n)).members;
    assert.equal(members.length, 10);
    const over = withMember(members, person(11));
    assert.equal(over.members.length, 10);
    assert.match(over.problem ?? "", /at most 10/);
  });
});

describe("draftProblem", () => {
  const chosen = type("a");

  test("needs a type and a member", () => {
    assert.match(draftProblem(emptyDraft(), undefined) ?? "", /Pick the type/);
    assert.match(draftProblem(emptyDraft("a"), chosen) ?? "", /at least one member/);
    assert.equal(draftProblem({ ...emptyDraft("a"), members: [person(1)] }, chosen), null);
  });

  test("holds the subject and first message to their limits", () => {
    const base = { ...emptyDraft("a"), members: [person(1)] };
    assert.match(draftProblem({ ...base, subject: "x".repeat(201) }, chosen) ?? "", /subject/);
    assert.match(draftProblem({ ...base, firstMessage: "x".repeat(2001) }, chosen) ?? "", /first message/);
    assert.equal(draftProblem({ ...base, subject: "x".repeat(200), firstMessage: "x".repeat(2000) }, chosen), null);
  });
});

describe("createRequest", () => {
  test("pairs filled answers with their questions and drops blank ones", () => {
    const chosen = type("a", {
      questions: [
        { label: "What happened?", style: "short", required: true },
        { label: "Match id", style: "short", required: false },
      ],
    });
    const request = createRequest(
      { ...emptyDraft("a"), answers: ["  Cheating report ", "   "], members: [person(1), person(2)], subject: " ", firstMessage: " Hi " },
      chosen,
    );
    assert.deepEqual(request.answers, [{ label: "What happened?", value: "Cheating report" }]);
    assert.equal(request.subject, null);
    assert.equal(request.firstMessage, "Hi");
    assert.equal(request.memberIds.length, 2);
    assert.equal(request.typeId, "a");
  });
});

describe("create route", () => {
  test("the proxy serves POST create only, as a workspace write", () => {
    assert.equal(ticketProxyClass("POST", ["create"]), "workspace");
    assert.equal(ticketProxyClass("GET", ["create"]), null);
    assert.equal(ticketProxyClass("DELETE", ["create"]), null);
    assert.equal(ticketProxyClass("POST", ["create", "extra"]), null);
  });

  test("the client calls the same address", () => {
    assert.equal(ticketsApiPath("1", "create"), "/api/guilds/1/tickets/create");
  });

  test("a bot without the route gets worded", () => {
    assert.match(createFailureText(404, "There is nothing at this address."), /too old/);
    assert.equal(createFailureText(409, "The category is full."), "The category is full.");
  });
});

describe("the n shortcut", () => {
  const press = (key: string, tagName = "BODY") => ({ key, ctrlKey: false, metaKey: false, altKey: false, target: { tagName } });

  test("opens a new ticket, and not while typing", () => {
    assert.equal(shortcutFor(press("n")), "new");
    assert.equal(shortcutFor(press("n", "TEXTAREA")), null);
    assert.ok(TICKET_SHORTCUTS.some((entry) => entry.action === "new" && entry.does === "Open a new ticket"));
  });
});
