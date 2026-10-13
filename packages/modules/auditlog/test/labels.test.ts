import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariablesToMessage, parseMessage, type FieldDescriptor, type MessageBody } from "@tier0/core";
import auditlog from "../dist/index.js";
import { DEFAULT_LABELS, deleteValues, editValues, updateValues } from "../dist/messages.js";

const LOG = "111111111111111111";
const registry = new ModuleRegistry();
registry.register(auditlog);

interface Sent {
  body: MessageBody;
  values: Record<string, string | number>;
}

function context(stored: unknown = {}) {
  const resolved = registry.resolveSettings("auditlog", { channel: LOG, ...(stored as object) });
  assert.ok(resolved.ok, resolved.ok ? "" : resolved.errors[0]?.message);
  const sent: Sent[] = [];
  const ctx = {
    settings: resolved.value,
    guild: { id: "1", channels: { cache: { get: () => ({ isTextBased: () => true }) } } },
    send: async (_target: unknown, body: MessageBody, values: Sent["values"]) => {
      sent.push({ body, values });
      return {};
    },
  };
  return { ctx: ctx as never, sent };
}

function fields(entry: Sent | undefined): string[] {
  assert.ok(entry, "nothing was sent");
  const strings = Object.fromEntries(Object.entries(entry.values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(entry.body, strings));
  assert.ok(parsed.ok);
  return parsed.value.embeds[0]?.fields.map((field) => field.value) ?? [];
}

const events = auditlog.events!;
const ada = { id: "222222222222222222", tag: "ada", bot: false };
const roles = (ids: string[]) => ({ roles: { cache: new Map(ids.map((id) => [id, {}])) } });

describe("the stand-in wording", () => {
  test("defaults to the words the log has always used", () => {
    assert.deepEqual(DEFAULT_LABELS, {
      authorUnknown: "Unknown (not cached)",
      deletedContent: "Unavailable (message was not cached)",
      editBefore: "Unavailable (not cached)",
      editAfter: "Unavailable",
      noNickname: "(none)",
    });
    const { ctx, sent } = context();
    const settings = (ctx as unknown as { settings: { labels: typeof DEFAULT_LABELS } }).settings;
    assert.deepEqual(settings.labels, DEFAULT_LABELS);
    assert.equal(sent.length, 0);
  });

  test("a deleted message nobody saw uses the server's words", async () => {
    const { ctx, sent } = context({ labels: { authorUnknown: "Someone", deletedContent: "Gone" } });
    await events.messageDelete!({ author: null, channelId: "333333333333333333", content: "" } as never, ctx);
    assert.deepEqual(fields(sent[0]), ["Someone", "<#333333333333333333>", "Gone"]);
  });

  test("an edit nobody saw uses the server's words for both sides", async () => {
    const { ctx, sent } = context({ labels: { editBefore: "Before: unknown", editAfter: "After: unreadable" } });
    const after = { author: ada, channelId: "333333333333333333", partial: true, content: "" };
    await events.messageUpdate!({ author: null, channelId: "333333333333333333", content: null } as never, after as never, ctx);
    assert.deepEqual(fields(sent[0]).slice(2), ["Before: unknown", "After: unreadable"]);
  });

  test("a member with no nickname uses the server's word", async () => {
    const { ctx, sent } = context({ labels: { noNickname: "no nickname" } });
    await events.memberUpdate!(
      { nickname: null, ...roles([]) } as never,
      { id: ada.id, user: ada, nickname: "Ada L.", ...roles([]) } as never,
      ctx,
    );
    assert.deepEqual(fields(sent[0]).slice(0, 3), ["<@222222222222222222> (ada)", "no nickname", "Ada L."]);
  });

  test("the value builders keep the old words when given no labels", () => {
    assert.equal(deleteValues({ channelId: "1" }).content, "Unavailable (message was not cached)");
    assert.equal(editValues({ channelId: "1" }, null, null, null)["before"], "Unavailable (not cached)");
    const diff = { nicknameChanged: true, nicknameBefore: null, nicknameAfter: null, rolesAdded: [], rolesRemoved: [] };
    assert.equal(updateValues(ada, diff, { nickname: true, roles: false })["nickname.after"], "(none)");
  });
});

describe("what the dashboard is told", () => {
  const summary = registry.describe().find((entry) => entry.id === "auditlog");
  const top = summary?.schema.fields as Record<string, FieldDescriptor>;

  test("the entries and the labels are collapsible groups", () => {
    assert.equal(top.messages?.collapsible, true);
    assert.equal(top.labels?.collapsible, true);
    assert.equal(top.labels?.label, "Labels and text");
    assert.equal(Object.keys(top.labels?.fields as object).length, 5);
  });
});
