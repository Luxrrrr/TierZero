import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TICKET_FILTERS, parseTicketListFilters, ticketAccess, type TicketAccessSettings } from "@tier0/core";
import { listOrder, listWhere, searchWhere, viewerScope } from "../dist/control/tickets/query.js";

const GUILD = "100000000000000001";
const ME = "500000000000000001";
const SETTINGS: TicketAccessSettings = {
  adminRoleIds: ["300000000000000009"],
  types: [
    { id: "billing", handlerRoleIds: ["300000000000000001"] },
    { id: "support", handlerRoleIds: ["300000000000000002"] },
  ],
};
const access = (roleIds: string[], isManager = false) => ticketAccess({ userId: ME, isManager, roleIds }, SETTINGS);

describe("viewerScope", () => {
  test("nobody sees nothing", () => {
    assert.equal(viewerScope(access([])), null);
    assert.equal(listWhere(GUILD, DEFAULT_TICKET_FILTERS, access([])), null);
  });

  test("managers and admin roles are not narrowed, so removed types stay visible", () => {
    assert.deepEqual(viewerScope(access([], true)), {});
    assert.deepEqual(viewerScope(access(["300000000000000009"])), {});
  });

  test("a handler sees their types only", () => {
    assert.deepEqual(viewerScope(access(["300000000000000001"])), { OR: [{ typeId: { in: ["billing"] } }] });
  });

  test("a handler of the legacy type also sees tickets with no type", () => {
    assert.deepEqual(viewerScope(access(["300000000000000002"])), { OR: [{ typeId: { in: ["support"] } }, { typeId: null }] });
  });
});

describe("listWhere", () => {
  test("always holds the guild and the viewer's scope, whatever the filters ask", () => {
    const where = listWhere(GUILD, parseTicketListFilters(new URLSearchParams("type=support&status=all")), access(["300000000000000001"]));
    const and = (where as { AND: unknown[] }).AND;
    assert.deepEqual(and[0], { guildId: GUILD });
    assert.deepEqual(and[1], { OR: [{ typeId: { in: ["billing"] } }] });
    assert.ok(and.some((part) => JSON.stringify(part) === JSON.stringify({ OR: [{ typeId: { in: ["support"] } }, { typeId: null }] })));
  });

  test("reads every filter", () => {
    const filters = parseTicketListFilters(
      new URLSearchParams(
        "status=closed&priority=high&claimed=me&opener=400000000000000001&rating=5&handler=500000000000000002&from=2026-10-01&to=2026-10-02",
      ),
    );
    const and = (listWhere(GUILD, filters, access([], true)) as { AND: unknown[] }).AND;
    const has = (part: unknown) => and.some((entry) => JSON.stringify(entry) === JSON.stringify(part));
    assert.ok(has({ status: "closed" }));
    assert.ok(has({ priority: "high" }));
    assert.ok(has({ claimedById: ME }));
    assert.ok(has({ openerId: "400000000000000001" }));
    assert.ok(has({ rating: 5 }));
    assert.ok(has({ OR: [{ claimedById: "500000000000000002" }, { closedBy: "500000000000000002" }, { firstResponderId: "500000000000000002" }] }));
    assert.ok(has({ openedAt: { gte: new Date("2026-10-01T00:00:00.000Z") } }));
    assert.ok(has({ openedAt: { lt: new Date("2026-10-03T00:00:00.000Z") } }));
  });

  test("unclaimed means no claimer, and all means no status filter", () => {
    const filters = parseTicketListFilters(new URLSearchParams("claimed=unclaimed&status=all"));
    const text = JSON.stringify(listWhere(GUILD, filters, access([], true)));
    assert.ok(text.includes('{"claimedById":null}'));
    assert.ok(!text.includes('"status"'));
  });
});

describe("searchWhere", () => {
  test("empty search adds nothing", () => {
    assert.equal(searchWhere("   "), null);
  });

  test("looks in the subject, the opener's name, the channel and the stored messages", () => {
    assert.deepEqual(searchWhere("refund"), {
      OR: [
        { subject: { contains: "refund" } },
        { openerName: { contains: "refund" } },
        { channelName: { contains: "refund" } },
        { messages: { some: { content: { contains: "refund" } } } },
      ],
    });
  });

  test("a ticket number matches the server's number, or the id of a ticket without one", () => {
    const where = searchWhere("#42") as { OR: unknown[] };
    assert.deepEqual(where.OR.slice(-2), [{ number: 42 }, { number: null, id: 42 }]);
    assert.equal((searchWhere("42x") as { OR: unknown[] }).OR.length, 4);
  });

  test("after keeps only tickets opened later than the one named", () => {
    const filters = parseTicketListFilters(new URLSearchParams("after=120"));
    assert.equal(filters.afterId, 120);
    const and = (listWhere(GUILD, filters, access([], true)) as { AND: unknown[] }).AND;
    assert.ok(and.some((part) => JSON.stringify(part) === JSON.stringify({ id: { gt: 120 } })));
    assert.equal(parseTicketListFilters(new URLSearchParams("after=-3")).afterId, null);
  });
});

describe("listOrder", () => {
  test("each sort has a stable tie-break", () => {
    assert.deepEqual(listOrder("newest"), [{ openedAt: "desc" }, { id: "desc" }]);
    assert.deepEqual(listOrder("oldest"), [{ openedAt: "asc" }, { id: "asc" }]);
    assert.deepEqual(listOrder("activity"), [{ lastActivityAt: "desc" }, { id: "desc" }]);
  });
});
