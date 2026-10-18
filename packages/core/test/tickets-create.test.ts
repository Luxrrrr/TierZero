import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_TYPE_ID, canTicket, readTicketCreate, ticketAccess, type TicketAccessSettings } from "../dist/tickets.js";

const ADMIN_ROLE = "100000000000000001";
const BILLING_ROLE = "100000000000000002";
const OTHER_ROLE = "100000000000000004";
const ME = "200000000000000001";
const MEMBER = "200000000000000002";
const MEMBER_TWO = "200000000000000003";

const SETTINGS: TicketAccessSettings = {
  adminRoleIds: [ADMIN_ROLE],
  types: [
    { id: "billing", handlerRoleIds: [BILLING_ROLE] },
    { id: LEGACY_TYPE_ID, handlerRoleIds: [] },
  ],
};

const access = (roleIds: string[], isManager = false, worksEveryType = false) =>
  ticketAccess({ userId: ME, isManager, worksEveryType, roleIds }, SETTINGS);
const forType = (typeId: string) => ({ typeId, status: "open" });

describe("who may open a ticket", () => {
  test("managers, admin roles and Manage Channels may open every type", () => {
    for (const who of [access([], true), access([ADMIN_ROLE]), access([], false, true)]) {
      assert.ok(canTicket(who, "create", forType("billing")));
      assert.ok(canTicket(who, "create", forType(LEGACY_TYPE_ID)));
    }
  });

  test("a handler may open the types they handle and no other", () => {
    const handler = access([BILLING_ROLE]);
    assert.ok(canTicket(handler, "create", forType("billing")));
    assert.ok(!canTicket(handler, "create", forType(LEGACY_TYPE_ID)));
    assert.ok(!canTicket(handler, "create", forType("unknown")));
  });

  test("without a type, anyone in the workspace may ask; nobody outside it", () => {
    assert.ok(canTicket(access([BILLING_ROLE]), "create"));
    assert.ok(!canTicket(access([OTHER_ROLE]), "create"));
    assert.ok(!canTicket(access([OTHER_ROLE]), "create", forType("billing")));
  });
});

describe("readTicketCreate", () => {
  const valid = { typeId: "billing", memberIds: [MEMBER] };

  test("reads the smallest request", () => {
    const read = readTicketCreate(valid);
    assert.ok(read.ok);
    assert.deepEqual(read.value, { typeId: "billing", subject: null, answers: [], memberIds: [MEMBER], firstMessage: null });
  });

  test("keeps the subject, the answers and the first message, trimmed", () => {
    const read = readTicketCreate({
      ...valid,
      subject: "  About  Friday ",
      answers: [{ label: "What happened?", value: " Report " }],
      firstMessage: " Hi \r\nthere ",
    });
    assert.ok(read.ok);
    assert.equal(read.value.subject, "About Friday");
    assert.deepEqual(read.value.answers, [{ label: "What happened?", value: "Report" }]);
    assert.equal(read.value.firstMessage, "Hi \nthere");
  });

  test("needs a type that looks like one", () => {
    assert.ok(!readTicketCreate({ memberIds: [MEMBER] }).ok);
    assert.ok(!readTicketCreate({ typeId: "../x", memberIds: [MEMBER] }).ok);
    assert.ok(!readTicketCreate(null).ok);
  });

  test("needs one to ten members, once each, as ids", () => {
    assert.ok(!readTicketCreate({ typeId: "billing", memberIds: [] }).ok);
    assert.ok(!readTicketCreate({ typeId: "billing" }).ok);
    assert.ok(!readTicketCreate({ typeId: "billing", memberIds: ["not-an-id"] }).ok);
    assert.ok(!readTicketCreate({ typeId: "billing", memberIds: [12345] }).ok);
    const twice = readTicketCreate({ typeId: "billing", memberIds: [MEMBER, MEMBER, MEMBER_TWO] });
    assert.ok(twice.ok);
    assert.deepEqual(twice.value.memberIds, [MEMBER, MEMBER_TWO]);
    const eleven = Array.from({ length: 11 }, (_, n) => String(300000000000000000n + BigInt(n)));
    const ten = readTicketCreate({ typeId: "billing", memberIds: eleven.slice(0, 10) });
    assert.ok(ten.ok);
    const over = readTicketCreate({ typeId: "billing", memberIds: eleven });
    assert.ok(!over.ok);
    assert.match(over.error, /at most 10/);
  });

  test("holds the subject, the form and the first message to their limits", () => {
    assert.ok(readTicketCreate({ ...valid, subject: "x".repeat(200) }).ok);
    assert.ok(!readTicketCreate({ ...valid, subject: "x".repeat(201) }).ok);
    assert.ok(readTicketCreate({ ...valid, firstMessage: "x".repeat(2000) }).ok);
    assert.ok(!readTicketCreate({ ...valid, firstMessage: "x".repeat(2001) }).ok);
    const answers = (count: number) => Array.from({ length: count }, (_, n) => ({ label: `Q${n}`, value: "a" }));
    assert.ok(readTicketCreate({ ...valid, answers: answers(5) }).ok);
    assert.ok(!readTicketCreate({ ...valid, answers: answers(6) }).ok);
    assert.ok(!readTicketCreate({ ...valid, answers: [{ label: "Q", value: 3 }] }).ok);
    assert.ok(!readTicketCreate({ ...valid, answers: "nope" }).ok);
  });
});
