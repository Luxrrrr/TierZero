import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeTicketStats, type StatsTicket } from "../dist/control/tickets/stats-calc.js";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BOT = "900000000000000001";
const OPENER = "400000000000000001";
const ALICE = "500000000000000001";
const BOB = "500000000000000002";

function ticket(overrides: Partial<StatsTicket> = {}): StatsTicket {
  return {
    typeId: "billing",
    typeName: "Billing",
    openerId: OPENER,
    status: "open",
    openedAt: new Date(NOW.getTime() - HOUR),
    closedAt: null,
    closedBy: null,
    firstResponseAt: null,
    rating: null,
    ratedAt: null,
    ...overrides,
  };
}

const run = (tickets: StatsTicket[], extra: Partial<Parameters<typeof computeTicketStats>[0]> = {}) =>
  computeTicketStats({ tickets, claims: [], now: NOW, days: 7, typeNames: new Map(), botId: BOT, ...extra });

describe("computeTicketStats", () => {
  test("the period starts at midnight and has one day row per day", () => {
    const stats = run([]);
    assert.equal(stats.since, "2026-10-07T00:00:00.000Z");
    assert.equal(stats.perDay.length, 7);
    assert.equal(stats.perDay[6]?.date, "2026-10-13");
    assert.equal(stats.byHour.length, 24);
    assert.deepEqual(stats.ratingDistribution, [0, 0, 0, 0, 0]);
    assert.equal(stats.medianFirstResponseMs, null);
    assert.equal(stats.averageRating, null);
  });

  test("counts open now regardless of when the ticket opened", () => {
    const stats = run([ticket(), ticket({ openedAt: new Date(NOW.getTime() - 60 * DAY) })]);
    assert.equal(stats.openNow, 2);
    assert.equal(stats.opened, 1);
  });

  test("opened and closed in the period, with the day and the hour", () => {
    const opened = new Date("2026-10-12T09:30:00.000Z");
    const stats = run([
      ticket({ openedAt: opened, status: "closed", closedAt: new Date("2026-10-13T10:00:00.000Z"), closedBy: ALICE }),
      ticket({ openedAt: new Date("2026-09-01T00:00:00.000Z"), status: "closed", closedAt: new Date("2026-10-08T00:00:00.000Z"), closedBy: BOB }),
    ]);
    assert.equal(stats.opened, 1);
    assert.equal(stats.closed, 2);
    assert.equal(stats.perDay.find((day) => day.date === "2026-10-12")?.opened, 1);
    assert.equal(stats.perDay.find((day) => day.date === "2026-10-13")?.closed, 1);
    assert.equal(stats.byHour[9], 1);
  });

  test("medians of first response and resolution", () => {
    const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR);
    const stats = run([
      ticket({ openedAt: at(10), firstResponseAt: at(9) }),
      ticket({ openedAt: at(10), firstResponseAt: at(7) }),
      ticket({ openedAt: at(10), firstResponseAt: at(4) }),
      ticket({ openedAt: at(10) }),
      ticket({ openedAt: at(20), status: "closed", closedAt: at(18), closedBy: ALICE }),
      ticket({ openedAt: at(20), status: "closed", closedAt: at(14), closedBy: ALICE }),
    ]);
    assert.equal(stats.medianFirstResponseMs, 3 * HOUR);
    assert.equal(stats.medianResolutionMs, 4 * HOUR);
  });

  test("ratings: average, count and distribution, inside the period only", () => {
    const closed = { status: "closed", closedAt: new Date(NOW.getTime() - DAY), closedBy: ALICE };
    const stats = run([
      ticket({ ...closed, rating: 5, ratedAt: new Date(NOW.getTime() - HOUR) }),
      ticket({ ...closed, rating: 4, ratedAt: new Date(NOW.getTime() - HOUR) }),
      ticket({ ...closed, rating: 4 }),
      ticket({ ...closed, rating: 1, ratedAt: new Date(NOW.getTime() - 30 * DAY) }),
      ticket({ ...closed, rating: 9 }),
    ]);
    assert.equal(stats.ratingCount, 3);
    assert.equal(stats.averageRating, 4.33);
    assert.deepEqual(stats.ratingDistribution, [0, 0, 0, 2, 1]);
  });

  test("per type uses the current type name and puts typeless tickets with the legacy type", () => {
    const stats = run(
      [ticket(), ticket(), ticket({ typeId: null, typeName: "" }), ticket({ typeId: "gone", typeName: "Old type" })],
      { typeNames: new Map([["billing", "Payments"], ["support", "Support"]]) },
    );
    const billing = stats.byType.find((entry) => entry.typeId === "billing");
    assert.equal(billing?.typeName, "Payments");
    assert.equal(billing?.opened, 2);
    assert.equal(billing?.openNow, 2);
    assert.equal(stats.byType.find((entry) => entry.typeId === "support")?.typeName, "Support");
    assert.equal(stats.byType.find((entry) => entry.typeId === "gone")?.typeName, "Old type");
    assert.equal(stats.byType[0]?.typeId, "billing");
  });

  test("per handler counts claims and closes, but not the opener's or the bot's closes", () => {
    const closedAt = new Date(NOW.getTime() - HOUR);
    const stats = run(
      [
        ticket({ status: "closed", closedAt, closedBy: ALICE }),
        ticket({ status: "closed", closedAt, closedBy: OPENER }),
        ticket({ status: "closed", closedAt, closedBy: BOT }),
      ],
      {
        claims: [
          { actorId: BOB, createdAt: closedAt },
          { actorId: BOB, createdAt: closedAt },
          { actorId: ALICE, createdAt: new Date(NOW.getTime() - 40 * DAY) },
          { actorId: null, createdAt: closedAt },
        ],
      },
    );
    assert.deepEqual(
      stats.byHandler.map(({ userId, claims, closes }) => ({ userId, claims, closes })),
      [
        { userId: BOB, claims: 2, closes: 0 },
        { userId: ALICE, claims: 0, closes: 1 },
      ],
    );
    assert.equal(stats.byHandler[0]?.listQuery, `status=all&handler=${BOB}`);
  });

  test("a first response recorded before the ticket opened is ignored", () => {
    const stats = run([ticket({ firstResponseAt: new Date(NOW.getTime() - 2 * HOUR) })]);
    assert.equal(stats.medianFirstResponseMs, null);
  });

  test("handles a large server quickly", () => {
    const tickets = Array.from({ length: 50_000 }, (_, index) =>
      ticket({
        openedAt: new Date(NOW.getTime() - (index % 90) * DAY),
        status: index % 2 ? "closed" : "open",
        closedAt: index % 2 ? new Date(NOW.getTime() - (index % 90) * DAY + HOUR) : null,
        closedBy: index % 2 ? ALICE : null,
      }),
    );
    const started = Date.now();
    const stats = run(tickets, { days: 90 });
    assert.ok(Date.now() - started < 2000);
    assert.equal(stats.openNow, 25_000);
    assert.equal(stats.perDay.length, 90);
  });
});
