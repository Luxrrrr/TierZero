import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_TYPE_ID, ModuleRegistry, canTicket, ticketAccess } from "@tier0/core";
import tickets from "../dist/index.js";
import {
  accessSettingsOf,
  allTypes,
  answersOf,
  channelRolesOf,
  cooldownOf,
  cooldownUntil,
  effectiveAutoClose,
  effectiveChannelName,
  effectiveLimit,
  effectiveTranscriptChannel,
  findPanel,
  findType,
  handlersOf,
  isBlocked,
  legacyButtonType,
  mayOpen,
  openTargetOf,
  openTargetRest,
  pingRolesOf,
  questionBounds,
  ratingEnabled,
  staffRolesOf,
  subjectOf,
  typeLabel,
  typeOfTicket,
} from "../dist/resolve.js";
import type { TicketSettings } from "../dist/settings.js";

const HELP_CHANNEL = "123456789012345678";
const CATEGORY = "223456789012345678";
const BILLING = "323456789012345678";
const SUPPORT = "423456789012345678";
const ADMIN = "523456789012345678";
const VIP = "623456789012345678";
const MUTED = "723456789012345678";
const OBSERVER = "823456789012345678";
const LOG = "923456789012345678";
const OWN_LOG = "993456789012345678";
const MEMBER = "103456789012345678";

const registry = new ModuleRegistry();
registry.register(tickets);

function parse(stored: unknown): TicketSettings {
  const result = registry.resolveSettings("tickets", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value as TicketSettings;
}

const settings = parse({
  panels: [
    {
      id: "main",
      name: "Main",
      channel: HELP_CHANNEL,
      types: [
        {
          id: "billing",
          name: "Billing",
          handlers: [BILLING],
          opening: { category: CATEGORY, channelName: "bill-{username}", ping: "none", observers: [OBSERVER] },
          rules: { limit: 3, cooldown: "1h", allowedRoles: [VIP] },
          overrides: { autoClose: "custom", autoCloseAfter: "2h", transcriptChannel: OWN_LOG, rating: "off" },
          appearance: { buttonLabel: "Pay up" },
        },
        {
          id: LEGACY_TYPE_ID,
          name: "Support",
          handlers: [SUPPORT],
          opening: { ping: "roles", pingRoles: [ADMIN] },
          rules: { blockedRoles: [MUTED] },
          overrides: { autoClose: "off", rating: "on" },
        },
      ],
    },
    { id: "side", name: "Side", types: [{ id: "appeals", name: "Appeals", handlers: [SUPPORT] }] },
  ],
  general: { ticketLimit: 2, channelName: "t-{username}", adminRoles: [ADMIN], blocklist: { members: [MEMBER], roles: [] } },
  transcripts: { logChannel: LOG },
  automation: { autoClose: { enabled: true, after: "1d", notice: true } },
  ratings: { enabled: false },
});

const type = (id: string) => {
  const found = allTypes(settings).find((entry) => entry.type.id === id);
  assert.ok(found, id);
  return found.type;
};

describe("finding a type", () => {
  test("by panel and type, or by type alone", () => {
    assert.equal(findType(settings, "main", "billing")?.type.name, "Billing");
    assert.equal(findType(settings, null, "appeals")?.panel.id, "side");
    assert.equal(findType(settings, "side", "billing")?.panel.id, "main", "a type found on another panel still opens");
    assert.equal(findType(settings, "main", "gone"), undefined);
    assert.equal(findPanel(settings, "side")?.name, "Side");
    assert.equal(findPanel(settings, "gone"), undefined);
  });

  test("a stored ticket without a type belongs to the legacy type", () => {
    assert.equal(typeOfTicket(settings, { panelId: null, typeId: null })?.type.id, LEGACY_TYPE_ID);
    assert.equal(typeOfTicket(settings, { panelId: "side", typeId: "appeals" })?.type.name, "Appeals");
    assert.equal(typeOfTicket(settings, { panelId: "main", typeId: "removed" }), undefined);
  });

  test("an old single button opens the legacy type, or the first type when it is gone", () => {
    assert.equal(legacyButtonType(settings)?.type.id, LEGACY_TYPE_ID);
    const without = parse({ panels: [{ id: "p", name: "P", types: [{ id: "first", name: "First" }] }] });
    assert.equal(legacyButtonType(without)?.type.id, "first");
    assert.equal(legacyButtonType(parse({ panels: [] })), undefined);
  });

  test("the custom id of a panel button round-trips", () => {
    assert.deepEqual(openTargetOf(openTargetRest("main", "billing")), { panelId: "main", typeId: "billing" });
    assert.equal(openTargetOf(""), null);
    assert.equal(openTargetOf("main"), null);
    assert.equal(openTargetOf("a:b:c"), null);
  });
});

describe("a per-type setting", () => {
  test("uses its own value when it has one and the general one otherwise", () => {
    assert.equal(effectiveLimit(settings, type("billing")), 3);
    assert.equal(effectiveLimit(settings, type("appeals")), 2);
    assert.equal(effectiveChannelName(settings, type("billing")), "bill-{username}");
    assert.equal(effectiveChannelName(settings, type("appeals")), "t-{username}");
    assert.equal(effectiveTranscriptChannel(settings, type("billing")), OWN_LOG);
    assert.equal(effectiveTranscriptChannel(settings, type("appeals")), LOG);
    assert.equal(effectiveTranscriptChannel(settings, undefined), LOG);
    assert.equal(effectiveTranscriptChannel(parse({ panels: [] }), undefined), null);
  });

  test("auto-close inherits, turns off, or uses its own time", () => {
    assert.deepEqual(effectiveAutoClose(settings, type("appeals")), { enabled: true, after: 86_400_000, notice: true });
    assert.equal(effectiveAutoClose(settings, type(LEGACY_TYPE_ID)).enabled, false);
    assert.deepEqual(effectiveAutoClose(settings, type("billing")), { enabled: true, after: 7_200_000, notice: true });
  });

  test("ratings inherit or are set per type", () => {
    assert.equal(ratingEnabled(settings, type("appeals")), false);
    assert.equal(ratingEnabled(settings, type(LEGACY_TYPE_ID)), true);
    assert.equal(ratingEnabled(settings, type("billing")), false);
    assert.equal(ratingEnabled(parse({ ratings: { enabled: true } }), undefined), true);
  });

  test("the button reads its own text, or the type's name", () => {
    assert.equal(typeLabel(type("billing")), "Pay up");
    assert.equal(typeLabel(type("appeals")), "Appeals");
  });
});

describe("who works a type", () => {
  test("handlers, then admin roles for staff, then observers for the channel", () => {
    assert.deepEqual(handlersOf(type("billing")), [BILLING]);
    assert.deepEqual(staffRolesOf(settings, type("billing")), [BILLING, ADMIN]);
    assert.deepEqual(staffRolesOf(settings, undefined), [ADMIN]);
    assert.deepEqual(channelRolesOf(settings, type("billing")), [BILLING, ADMIN, OBSERVER]);
  });

  test("the ping follows the type's choice", () => {
    assert.deepEqual(pingRolesOf(type("billing")), []);
    assert.deepEqual(pingRolesOf(type(LEGACY_TYPE_ID)), [ADMIN]);
    assert.deepEqual(pingRolesOf(type("appeals")), [SUPPORT]);
  });

  test("the access rules see every type, its handlers and the general switches", () => {
    const view = accessSettingsOf(settings);
    assert.deepEqual(view.adminRoleIds, [ADMIN]);
    assert.deepEqual(
      view.types.map((entry) => [entry.id, entry.handlerRoleIds]),
      [
        ["billing", [BILLING]],
        [LEGACY_TYPE_ID, [SUPPORT]],
        ["appeals", [SUPPORT]],
      ],
    );
    assert.equal(view.reopen, false, "reopening needs channels to be kept");
    assert.equal(accessSettingsOf(parse({ general: { closeBehaviour: "archive" } })).reopen, true);
    const access = ticketAccess({ userId: MEMBER, isManager: false, roleIds: [SUPPORT] }, view);
    assert.deepEqual(access.handledTypeIds, [LEGACY_TYPE_ID, "appeals"]);
    assert.equal(canTicket(access, "reply", { typeId: "billing", status: "open" }), false);
  });
});

describe("who may open a type", () => {
  test("a member on the blocklist, or with a blocked role, may open nothing", () => {
    assert.equal(isBlocked(settings, { id: MEMBER, roleIds: [] }), true);
    assert.deepEqual(mayOpen(settings, type("appeals"), { id: MEMBER, roleIds: [VIP] }), { allowed: false, code: "blocked" });
    const byRole = parse({ panels: [], general: { blocklist: { roles: [MUTED] } } });
    assert.equal(isBlocked(byRole, { id: "1", roleIds: [MUTED] }), true);
    assert.equal(isBlocked(byRole, { id: "1", roleIds: [] }), false);
  });

  test("a type can be limited to some roles, or closed to others", () => {
    assert.deepEqual(mayOpen(settings, type("billing"), { id: "1", roleIds: [] }), { allowed: false, code: "notAllowed" });
    assert.deepEqual(mayOpen(settings, type("billing"), { id: "1", roleIds: [VIP] }), { allowed: true });
    assert.deepEqual(mayOpen(settings, type(LEGACY_TYPE_ID), { id: "1", roleIds: [MUTED] }), { allowed: false, code: "notAllowed" });
    assert.deepEqual(mayOpen(settings, type("appeals"), { id: "1", roleIds: [] }), { allowed: true });
  });

  test("a cooldown runs from when the last one opened", () => {
    const at = new Date("2026-10-19T12:00:00Z");
    assert.equal(cooldownOf(type("billing")), 3_600_000);
    assert.equal(cooldownUntil(type("billing"), at)?.toISOString(), "2026-10-19T13:00:00.000Z");
    assert.equal(cooldownOf(type("appeals")), 0);
    assert.equal(cooldownUntil(type("appeals"), at), null);
  });
});

describe("the form", () => {
  test("bounds are held to what Discord accepts", () => {
    const base = { label: "Q", style: "short", required: true };
    assert.deepEqual(questionBounds(base), { min: undefined, max: 4000 });
    assert.deepEqual(questionBounds({ ...base, minLength: 10, maxLength: 5 }), { min: 5, max: 5 });
    assert.deepEqual(questionBounds({ ...base, minLength: 2, maxLength: 200 }), { min: 2, max: 200 });
  });

  test("answers keep the question's wording, and the first one given is the subject", () => {
    const form = [
      { label: "Order", style: "short", required: false },
      { label: "Problem", style: "paragraph", required: true },
    ];
    const answers = answersOf(form, ["  ", " It broke "]);
    assert.deepEqual(answers, [
      { label: "Order", value: "" },
      { label: "Problem", value: "It broke" },
    ]);
    assert.equal(subjectOf(answers), "It broke");
    assert.equal(subjectOf([]), null);
    assert.equal(subjectOf([{ label: "x", value: "y".repeat(300) }])?.length, 200);
  });
});
