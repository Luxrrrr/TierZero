import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent } from "discord.js";
import { ModuleRegistry, applyVariablesToMessage, parseMessage, type MessageBody } from "@tier0/core";
import auditlog from "../dist/index.js";
import { ENTRIES, STARTING, stickerChanges } from "../dist/messages.js";
import { serverChanges, timeoutChange, voiceChange, type ServerSnapshot } from "../dist/diff.js";

const LOG = "111111111111111111";
const VOICE_LOG = "111111111111111112";
const registry = new ModuleRegistry();
registry.register(auditlog);

interface Sent {
  channel: string;
  body: MessageBody;
  values: Record<string, string | number>;
}

function context(stored: Record<string, unknown> = {}) {
  const resolved = registry.resolveSettings("auditlog", { channel: LOG, ...stored });
  assert.ok(resolved.ok, "settings should resolve");
  const sent: Sent[] = [];
  const ctx = {
    settings: resolved.value,
    client: { users: { fetch: async (id: string) => ({ id, tag: "fragmuffin" }) } },
    guild: { id: "1", channels: { cache: { get: (id: string) => ({ id, isTextBased: () => true }) } } },
    send: async (target: { id: string }, body: MessageBody, values: Sent["values"]) => {
      sent.push({ channel: target.id, body, values });
      return {};
    },
  };
  return { ctx: ctx as never, sent };
}

function text(entry: Sent | undefined): string {
  assert.ok(entry, "nothing was sent");
  const strings = Object.fromEntries(Object.entries(entry.values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(entry.body, strings));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors[0]?.message);
  const embed = parsed.value.embeds[0];
  return [embed?.title, ...(embed?.fields ?? []).map((f) => `${f.name}=${f.value}`)].join(" | ");
}

const events = auditlog.events!;
const rook = { id: "222222222222222222", tag: "rook", bot: false };
const musicBot = { id: "222222222222222223", tag: "beatbox", bot: true };
const NEW_EVENTS = [
  "memberTimeout",
  "memberTimeoutEnd",
  "memberKick",
  "voiceJoin",
  "voiceLeave",
  "voiceMove",
  "inviteCreate",
  "inviteDelete",
  "threadCreate",
  "threadDelete",
  "threadArchive",
  "emojiCreate",
  "emojiUpdate",
  "emojiDelete",
  "stickerCreate",
  "stickerUpdate",
  "stickerDelete",
  "serverUpdate",
] as const;

describe("what changed", () => {
  const now = 1_000_000;
  test("a timeout put on, made longer, taken off, or left to run out", () => {
    assert.equal(timeoutChange(null, now + 60_000, now), "add");
    assert.equal(timeoutChange(now + 60_000, now + 120_000, now), "add");
    assert.equal(timeoutChange(now + 60_000, null, now), "remove");
    assert.equal(timeoutChange(now - 1, null, now), null);
    assert.equal(timeoutChange(null, null, now), null);
  });

  test("joining, leaving and moving voice, but not muting", () => {
    assert.equal(voiceChange(null, "a"), "join");
    assert.equal(voiceChange("a", null), "leave");
    assert.equal(voiceChange("a", "b"), "move");
    assert.equal(voiceChange("a", "a"), null);
  });

  test("server settings, one line each, with pictures named and not hashed", () => {
    const before: ServerSnapshot = {
      name: "Night Raid",
      description: null,
      icon: "abc",
      banner: null,
      verificationLevel: 1,
      afkChannelId: null,
      afkTimeout: 300,
      systemChannelId: "5",
      rulesChannelId: null,
      ownerId: "9",
    };
    assert.deepEqual(serverChanges(before, { ...before }), []);
    assert.deepEqual(serverChanges(before, { ...before, name: "Night Raiders", icon: "def", verificationLevel: 3, afkChannelId: "7" }), [
      "Name: Night Raid to Night Raiders",
      "Icon: changed",
      "Verification level: Low to High",
      "Inactive channel: (none) to <#7>",
    ]);
  });

  test("a sticker's name, description and emoji", () => {
    const gg = { name: "gg", description: null, tags: "trophy" };
    assert.deepEqual(stickerChanges(gg, { ...gg }), []);
    assert.deepEqual(stickerChanges(gg, { ...gg, name: "goodgame", description: "well played" }), [
      "Name: gg to goodgame",
      "Description: (none) to well played",
    ]);
  });
});

describe("the new kinds of entry", () => {
  test("each has a message, a starting post and help naming its switch", () => {
    const settingsSchema = registry.describe().find((m) => m.id === "auditlog")!.schema as { fields: Record<string, { fields: Record<string, unknown> }> };
    for (const event of NEW_EVENTS) {
      assert.ok(STARTING[event], `${event} has a starting post`);
      assert.ok(ENTRIES[event].help.includes("switch"), `${event} names its switch`);
      assert.ok(settingsSchema.fields.messages!.fields[event], `${event} can be reworded`);
    }
  });

  test("kicks and timeouts are on from the start, the noisier kinds are off", () => {
    const { ctx } = context();
    const on = (ctx as { settings: { events: Record<string, boolean> } }).settings.events;
    assert.equal(on.kick && on.timeoutAdd && on.timeoutRemove, true);
    for (const key of ["voiceJoin", "voiceLeave", "voiceMove", "inviteCreate", "inviteDelete", "threadCreate", "threadDelete", "threadArchive", "emojiChange", "stickerChange", "serverUpdate"]) {
      assert.equal(on[key], false, key);
    }
  });

  test("a timeout says when it ends, and lifting it early is its own entry", async () => {
    const { ctx, sent } = context();
    const member = (until: number | null) => ({ user: rook, nickname: null, roles: { cache: new Map() }, communicationDisabledUntilTimestamp: until });
    const until = Date.now() + 600_000;
    await events.memberUpdate!(member(null) as never, member(until) as never, ctx);
    await events.memberUpdate!(member(until) as never, member(null) as never, ctx);
    const seconds = Math.floor(until / 1000);
    assert.equal(text(sent[0]), `Member timed out | Member=<@${rook.id}> (rook) | Until=<t:${seconds}:f> (<t:${seconds}:R>)`);
    assert.equal(text(sent[1]), `Timeout removed | Member=<@${rook.id}> (rook)`);
  });

  test("a kick comes from the audit log, with who did it and why", async () => {
    const { ctx, sent } = context();
    await events.auditLogEntry!({ action: AuditLogEvent.MemberKick, targetId: "333333333333333333", target: null, executor: rook, reason: "Spamming the lobby" } as never, ctx);
    await events.auditLogEntry!({ action: AuditLogEvent.MemberBanAdd, targetId: "333333333333333333", target: null, executor: rook, reason: null } as never, ctx);
    assert.equal(sent.length, 1);
    assert.equal(text(sent[0]), `Member kicked | Member=<@333333333333333333> (fragmuffin) | Moderator=<@${rook.id}> (rook) | Reason=Spamming the lobby`);
  });

  test("voice activity goes to its own channel when it has one, and skips bots and ignored channels", async () => {
    const { ctx, sent } = context({
      events: { voiceJoin: true, voiceMove: true },
      channels: { voice: VOICE_LOG },
      ignoreChannels: ["444444444444444449"],
    });
    const state = (user: typeof rook, channel: { id: string; name: string; parentId: string | null } | null) => ({ member: { user }, channel });
    const squad1 = { id: "444444444444444441", name: "Squad 1", parentId: null };
    const squad2 = { id: "444444444444444442", name: "Squad 2", parentId: null };
    const afk = { id: "444444444444444449", name: "AFK", parentId: null };

    await events.voiceStateUpdate!(state(rook, null) as never, state(rook, squad1) as never, ctx);
    await events.voiceStateUpdate!(state(musicBot, null) as never, state(musicBot, squad1) as never, ctx);
    await events.voiceStateUpdate!(state(rook, null) as never, state(rook, afk) as never, ctx);
    await events.voiceStateUpdate!(state(rook, squad1) as never, state(rook, squad2) as never, ctx);
    await events.voiceStateUpdate!(state(rook, squad2) as never, state(rook, null) as never, ctx);

    assert.equal(sent.length, 2, "the bot, the ignored channel and the switched-off leave are left out");
    assert.equal(sent[0]!.channel, VOICE_LOG);
    assert.equal(text(sent[0]), `Joined voice | Member=<@${rook.id}> (rook) | Channel=<#${squad1.id}> (Squad 1)`);
    assert.equal(text(sent[1]), `Moved voice channel | Member=<@${rook.id}> (rook) | From=<#${squad1.id}> (Squad 1) | To=<#${squad2.id}> (Squad 2)`);
  });

  test("an invite says who made it and how long it lasts", async () => {
    const { ctx, sent } = context({ events: { inviteCreate: true } });
    await events.inviteCreate!({ code: "nightraid", channelId: "555555555555555555", inviter: rook, maxUses: 0, expiresTimestamp: null } as never, ctx);
    assert.equal(text(sent[0]), `Invite created | Invite=nightraid | Channel=<#555555555555555555> | Created by=<@${rook.id}> (rook) | Uses=No limit | Expires=Never`);
  });

  test("a thread is logged as archived only when it becomes archived", async () => {
    const { ctx, sent } = context({ events: { threadArchive: true } });
    const thread = (archived: boolean) => ({ id: "666666666666666666", name: "lfg-tonight", parentId: "777777777777777777", archived });
    await events.threadUpdate!(thread(false) as never, thread(true) as never, ctx);
    await events.threadUpdate!(thread(true) as never, thread(true) as never, ctx);
    await events.threadUpdate!(thread(true) as never, thread(false) as never, ctx);
    assert.equal(sent.length, 1);
    assert.equal(text(sent[0]), "Thread archived | Thread=<#666666666666666666> (lfg-tonight) | In=<#777777777777777777>");
  });

  test("server setting changes list what changed, and say nothing when nothing a reader sees did", async () => {
    const { ctx, sent } = context({ events: { serverUpdate: true }, channels: { settings: VOICE_LOG } });
    const guild = { name: "Night Raid", description: null, icon: null, banner: null, verificationLevel: 0, afkChannelId: null, afkTimeout: 300, systemChannelId: null, rulesChannelId: null, ownerId: "9" };
    await events.guildUpdate!(guild as never, { ...guild } as never, ctx);
    await events.guildUpdate!(guild as never, { ...guild, name: "Night Raiders" } as never, ctx);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.channel, VOICE_LOG);
    assert.equal(text(sent[0]), "Server settings changed | Changes=Name: Night Raid to Night Raiders");
  });

  test("emoji changes stay quiet until switched on", async () => {
    const emoji = { id: "888888888888888888", name: "gg", animated: false };
    const off = context();
    await events.emojiCreate!(emoji as never, off.ctx);
    assert.equal(off.sent.length, 0);
    const on = context({ events: { emojiChange: true } });
    await events.emojiCreate!(emoji as never, on.ctx);
    assert.equal(text(on.sent[0]), "Emoji added | Emoji=<:gg:888888888888888888> (gg)");
  });
});
