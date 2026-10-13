import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariablesToMessage, emptyEmbed, parseMessage, type MessageBody } from "@tier0/core";
import auditlog from "../dist/index.js";
import { STARTING } from "../dist/messages.js";

const LOG = "111111111111111111";
const registry = new ModuleRegistry();
registry.register(auditlog);

interface Sent {
  body: MessageBody;
  values: Record<string, string | number>;
  fallback?: MessageBody;
}

function context(stored: unknown = {}) {
  const resolved = registry.resolveSettings("auditlog", { channel: LOG, ...(stored as object) });
  assert.ok(resolved.ok, "settings should resolve");
  const sent: Sent[] = [];
  const ctx = {
    settings: resolved.value,
    guild: { id: "1", channels: { cache: { get: () => ({ isTextBased: () => true }) } } },
    send: async (_target: unknown, body: MessageBody, values: Sent["values"], options?: { fallback?: MessageBody }) => {
      sent.push({ body, values, fallback: options?.fallback });
      return {};
    },
  };
  return { ctx: ctx as never, sent, settings: resolved.value as { messages: Record<string, MessageBody> } };
}

/** Fills a message the way the bot does before it is sent. */
function render(entry: Sent | undefined): MessageBody {
  assert.ok(entry, "nothing was sent");
  const strings = Object.fromEntries(Object.entries(entry.values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(entry.body, strings));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors[0]?.message);
  return parsed.value;
}

const embedOf = (title: string, color: string, fields: { name: string; value: string; inline?: boolean }[], url = "") => [
  { ...emptyEmbed(), title, color, url, timestamp: "now", fields: fields.map((f) => ({ inline: false, ...f })) },
];

const events = auditlog.events!;
const ada = { id: "222222222222222222", tag: "ada", bot: false, createdTimestamp: 1_700_000_000_000 };

describe("the log entries", () => {
  test("a deleted message reads as it always has", async () => {
    const { ctx, sent } = context();
    await events.messageDelete!({ author: ada, channelId: "333333333333333333", content: "hello" } as never, ctx);
    assert.deepEqual(
      render(sent[0]).embeds,
      embedOf("Message deleted", "#ed4245", [
        { name: "Author", value: "<@222222222222222222> (ada)", inline: true },
        { name: "Channel", value: "<#333333333333333333>", inline: true },
        { name: "Content", value: "hello" },
      ]),
    );
  });

  test("a deleted message the bot never saw still says what is known", async () => {
    const { ctx, sent } = context();
    await events.messageDelete!({ author: null, channelId: "333333333333333333", content: "" } as never, ctx);
    const values = render(sent[0]).embeds[0]?.fields.map((f) => f.value);
    assert.deepEqual(values, ["Unknown (not cached)", "<#333333333333333333>", "Unavailable (message was not cached)"]);
  });

  test("an edited message reads as it always has, and links to the message", async () => {
    const { ctx, sent } = context();
    const base = { author: ada, channelId: "333333333333333333", partial: false, url: "https://discord.com/channels/1/3/4" };
    await events.messageUpdate!({ ...base, content: "one" } as never, { ...base, content: "two" } as never, ctx);
    assert.deepEqual(
      render(sent[0]).embeds,
      embedOf(
        "Message edited",
        "#faa61a",
        [
          { name: "Author", value: "<@222222222222222222> (ada)", inline: true },
          { name: "Channel", value: "<#333333333333333333>", inline: true },
          { name: "Before", value: "one" },
          { name: "After", value: "two" },
        ],
        "https://discord.com/channels/1/3/4",
      ),
    );
  });

  test("an edit to an uncached message has no link and says the old text is unavailable", async () => {
    const { ctx, sent } = context();
    const after = { author: ada, channelId: "333333333333333333", partial: true, content: "two" };
    await events.messageUpdate!({ author: null, channelId: "333333333333333333", content: null } as never, after as never, ctx);
    const embed = render(sent[0]).embeds[0];
    assert.equal(embed?.url, "");
    assert.equal(embed?.fields[2]?.value, "Unavailable (not cached)");
  });

  test("joins and departures read as they always have", async () => {
    const { ctx, sent } = context();
    await events.memberJoin!({ id: ada.id, user: ada } as never, ctx);
    await events.memberLeave!({ id: ada.id, user: ada } as never, ctx);
    assert.deepEqual(
      render(sent[0]).embeds,
      embedOf("Member joined", "#57f287", [
        { name: "Member", value: "<@222222222222222222> (ada)", inline: true },
        { name: "Account created", value: "<t:1700000000:R>", inline: true },
      ]),
    );
    assert.deepEqual(
      render(sent[1]).embeds,
      embedOf("Member left", "#ed4245", [{ name: "Member", value: "<@222222222222222222> (ada)" }]),
    );
  });

  const roles = (ids: string[]) => ({ roles: { cache: new Map(ids.map((id) => [id, {}])) } });

  test("a nickname and role change reads as it always has", async () => {
    const { ctx, sent } = context();
    await events.memberUpdate!(
      { nickname: null, ...roles(["10"]) } as never,
      { id: ada.id, user: ada, nickname: "Ada L.", ...roles(["11"]) } as never,
      ctx,
    );
    assert.deepEqual(
      render(sent[0]).embeds,
      embedOf("Member updated", "#5865f2", [
        { name: "Member", value: "<@222222222222222222> (ada)" },
        { name: "Nickname before", value: "(none)", inline: true },
        { name: "Nickname after", value: "Ada L.", inline: true },
        { name: "Roles added", value: "<@&11>" },
        { name: "Roles removed", value: "<@&10>" },
      ]),
    );
  });

  test("a role change alone leaves the nickname lines out, and so does a switched-off category", async () => {
    const { ctx, sent } = context();
    await events.memberUpdate!({ nickname: "A", ...roles([]) } as never, { id: ada.id, user: ada, nickname: "A", ...roles(["11"]) } as never, ctx);
    assert.deepEqual(render(sent[0]).embeds[0]?.fields.map((f) => f.name), ["Member", "Roles added"]);

    const off = context({ events: { roleChange: false } });
    await events.memberUpdate!(
      { nickname: "A", ...roles([]) } as never,
      { id: ada.id, user: ada, nickname: "B", ...roles(["11"]) } as never,
      off.ctx,
    );
    assert.deepEqual(render(off.sent[0]).embeds[0]?.fields.map((f) => f.name), ["Member", "Nickname before", "Nickname after"]);
  });

  test("channels and roles read as they always have", async () => {
    const { ctx, sent } = context({ events: { roleCreate: true, roleDelete: true } });
    await events.channelCreate!({ id: "44", name: "events" } as never, ctx);
    await events.channelDelete!({ id: "44", name: "events" } as never, ctx);
    await events.roleCreate!({ id: "55", name: "Member" } as never, ctx);
    await events.roleDelete!({ id: "55", name: "Member" } as never, ctx);
    assert.deepEqual(render(sent[0]).embeds, embedOf("Channel created", "#57f287", [{ name: "Channel", value: "<#44> (events)" }]));
    assert.deepEqual(render(sent[1]).embeds, embedOf("Channel deleted", "#ed4245", [{ name: "Channel", value: "#events" }]));
    assert.deepEqual(render(sent[2]).embeds, embedOf("Role created", "#57f287", [{ name: "Role", value: "<@&55> (Member)" }]));
    assert.deepEqual(render(sent[3]).embeds, embedOf("Role deleted", "#ed4245", [{ name: "Role", value: "Member" }]));
  });

  test("bans show the reason only when there is one, and unbans read as they always have", async () => {
    const { ctx, sent } = context();
    await events.banAdd!({ user: ada, partial: false, reason: "Spam" } as never, ctx);
    await events.banAdd!({ user: ada, partial: true, reason: null } as never, ctx);
    await events.banRemove!({ user: ada } as never, ctx);
    assert.deepEqual(
      render(sent[0]).embeds,
      embedOf("Member banned", "#ed4245", [
        { name: "Member", value: "<@222222222222222222> (ada)" },
        { name: "Reason", value: "Spam" },
      ]),
    );
    assert.deepEqual(render(sent[1]).embeds[0]?.fields.map((f) => f.name), ["Member"]);
    assert.deepEqual(
      render(sent[2]).embeds,
      embedOf("Member unbanned", "#57f287", [{ name: "Member", value: "<@222222222222222222> (ada)" }]),
    );
  });
});

describe("customising an entry", () => {
  test("uses the owner's message and hands over the starting one as the fallback", async () => {
    const custom = { content: "", embeds: [{ title: "{member} left", description: "{member}" }] };
    const { ctx, sent } = context({ messages: { memberLeave: custom } });
    await events.memberLeave!({ id: ada.id, user: ada } as never, ctx);
    assert.equal(render(sent[0]).embeds[0]?.title, "<@222222222222222222> (ada) left");
    assert.equal(sent[0]?.fallback, STARTING.memberLeave);
  });

  test("reads a plain string as a message that is only text", () => {
    const { settings } = context({ messages: { banRemove: "Unbanned {member}" } });
    assert.equal(settings.messages.banRemove?.content, "Unbanned {member}");
  });

  test("the starting messages stay valid when their longest values are filled in", async () => {
    const { ctx, sent } = context();
    const long = "x".repeat(3000);
    const base = { author: ada, channelId: "333333333333333333", partial: false, url: "https://discord.com/channels/1/3/4" };
    await events.messageDelete!({ ...base, content: long } as never, ctx);
    await events.messageUpdate!({ ...base, content: long } as never, { ...base, content: `${long}y` } as never, ctx);
    await events.banAdd!({ user: ada, partial: false, reason: long } as never, ctx);
    assert.equal(sent.length, 3);
    for (const entry of sent) render(entry);
  });

  test("sends nothing without a log channel", async () => {
    const { ctx, sent } = context({ channel: undefined });
    await events.memberLeave!({ id: ada.id, user: ada } as never, ctx);
    assert.equal(sent.length, 0);
  });
});
