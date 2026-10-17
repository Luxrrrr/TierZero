import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariables, plainReply, type MessageBody } from "@tier0/core";
import welcome from "../dist/index.js";
import { JOIN_DM, JOIN_MESSAGE, LEAVE_DM, LEAVE_MESSAGE, upgradeGroup, valuesFor } from "../dist/messages.js";

const CHANNEL = "123456789012345678";

const registry = new ModuleRegistry();
registry.register(welcome);

interface Resolved {
  join: { channel?: string; message: MessageBody; sendDm: boolean; dm: MessageBody };
  leave: { channel?: string; message: MessageBody; sendDm: boolean; dm: MessageBody };
}

function resolve(stored: unknown): Resolved {
  const result = registry.resolveSettings("welcome", stored);
  assert.ok(result.ok, "settings should resolve");
  return result.value as Resolved;
}

const member = {
  id: "42",
  user: { username: "ada" },
  guild: { name: "Northwind", memberCount: 128 },
};

describe("the defaults", () => {
  test("are the starting messages, with direct messages off", () => {
    const settings = resolve({});
    assert.deepEqual(settings.join.message, JOIN_MESSAGE);
    assert.deepEqual(settings.join.dm, JOIN_DM);
    assert.deepEqual(settings.leave.message, LEAVE_MESSAGE);
    assert.deepEqual(settings.leave.dm, LEAVE_DM);
    assert.equal(settings.join.sendDm, false);
    assert.equal(settings.leave.sendDm, false);
    assert.equal(settings.join.channel, undefined);
  });

  test("fill in with the module's own variables", () => {
    const values = valuesFor(member);
    assert.equal(applyVariables(JOIN_MESSAGE.content, values), "<@42>");
    assert.equal(applyVariables(JOIN_MESSAGE.embeds[0]?.description ?? "", values), "Welcome to Northwind!");
    assert.equal(applyVariables(LEAVE_MESSAGE.embeds[0]?.description ?? "", values), "ada has left Northwind.");
    assert.equal(applyVariables("member {memberCount}", values), "member 128");
  });
});

describe("the default look", () => {
  test("every default is one info embed", () => {
    for (const body of [JOIN_MESSAGE, LEAVE_MESSAGE, JOIN_DM, LEAVE_DM]) {
      assert.equal(body.embeds.length, 1);
      assert.equal(body.embeds[0]?.color, REPLY_COLOR.info);
    }
  });

  test("the join greeting keeps the mention above the embed so it pings", () => {
    assert.equal(JOIN_MESSAGE.content, "{user}");
    assert.ok(!JOIN_MESSAGE.embeds[0]?.description.includes("{user}"));
  });

  test("the farewell and the direct messages carry no text above the embed", () => {
    for (const body of [LEAVE_MESSAGE, JOIN_DM, LEAVE_DM]) assert.equal(body.content, "");
  });
});

describe("a greeting saved as a plain string", () => {
  test("is still read, as a message that is only that text", () => {
    const settings = resolve({ join: { channel: CHANNEL, message: "Hi {user}, welcome to {server}" } });
    assert.equal(settings.join.message.content, "Hi {user}, welcome to {server}");
    assert.deepEqual(settings.join.message.embeds, []);
  });

  test("with the embed switch on becomes the description of a bare embed", () => {
    const settings = resolve({ join: { channel: CHANNEL, message: "Hi {user}", embed: true } });
    assert.equal(settings.join.message.content, "");
    assert.equal(settings.join.message.embeds.length, 1);
    assert.equal(settings.join.message.embeds[0]?.description, "Hi {user}");
    assert.equal(settings.join.message.embeds[0]?.title, "");
    assert.equal(settings.join.message.embeds[0]?.color, "");
  });

  test("with the embed switch off stays text only", () => {
    const settings = resolve({ leave: { channel: CHANNEL, message: "Bye {username}", embed: false } });
    assert.equal(settings.leave.message.content, "Bye {username}");
    assert.deepEqual(settings.leave.message.embeds, []);
  });

  test("an old direct message is kept and switched on", () => {
    const settings = resolve({ join: { dm: "Welcome to {server}" }, leave: { dm: "Bye" } });
    assert.equal(settings.join.sendDm, true);
    assert.equal(settings.join.dm.content, "Welcome to {server}");
    assert.equal(settings.leave.sendDm, true);
    assert.equal(settings.leave.dm.content, "Bye");
  });

  test("a blank old direct message stays off", () => {
    const settings = resolve({ join: { dm: "   " } });
    assert.equal(settings.join.sendDm, false);
    assert.deepEqual(settings.join.dm, JOIN_DM);
  });
});

describe("Leave bots out", () => {
  const ignoreBots = (stored: unknown) => (resolve(stored) as unknown as { ignoreBots: boolean }).ignoreBots;

  test("is on for a server with nothing stored", () => {
    assert.equal(ignoreBots({}), true);
    assert.equal(ignoreBots(undefined), true);
  });

  test("is off for settings saved before the switch existed, so bots are still welcomed", () => {
    assert.equal(ignoreBots({ join: { channel: CHANNEL, roles: [] } }), false);
  });

  test("keeps a value that was saved", () => {
    assert.equal(ignoreBots({ ignoreBots: true, join: { channel: CHANNEL } }), true);
    assert.equal(ignoreBots({ ignoreBots: false }), false);
  });
});

describe("upgradeGroup", () => {
  test("leaves a current value alone and is idempotent", () => {
    const current = { channel: CHANNEL, message: plainReply("Hi"), sendDm: false, dm: plainReply("DM") };
    assert.deepEqual(upgradeGroup(current), current);
    const old = { channel: CHANNEL, message: "Hi {user}", embed: true, dm: "Hello" };
    const once = upgradeGroup(old);
    assert.deepEqual(upgradeGroup(once), once);
  });

  test("respects a direct message switched off on purpose", () => {
    assert.equal(upgradeGroup({ dm: plainReply("DM"), sendDm: false }).sendDm, false);
  });
});

describe("sending", () => {
  function fakeCtx(settings: Resolved) {
    const sent: { target: unknown; body: MessageBody; values: Record<string, string | number> | undefined; fallback: MessageBody | undefined }[] = [];
    const channel = { id: CHANNEL, isTextBased: () => true };
    return {
      sent,
      ctx: {
        guild: {
          name: "Northwind",
          memberCount: 128,
          channels: { cache: new Map([[CHANNEL, channel]]) },
          members: { me: { roles: { highest: { position: 10 } } } },
          roles: { cache: new Map() },
        },
        settings: { ...settings, join: { ...settings.join, roles: [] } },
        send: async (target: unknown, body: MessageBody, values?: Record<string, string | number>, options?: { fallback?: MessageBody }) => {
          sent.push({ target, body, values, fallback: options?.fallback });
          return null;
        },
      },
      channel,
    };
  }

  const events = welcome.events as unknown as {
    memberJoin(member: unknown, ctx: unknown): Promise<void>;
    memberLeave(member: unknown, ctx: unknown): Promise<void>;
  };
  const guildMember = { ...member, user: { username: "ada" }, roles: { add: async () => undefined } };

  test("a join with only a channel posts the default greeting with a fallback", async () => {
    const { ctx, sent, channel } = fakeCtx(resolve({ join: { channel: CHANNEL } }));
    await events.memberJoin({ ...guildMember, guild: ctx.guild }, ctx);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.target, channel);
    assert.deepEqual(sent[0]?.body, JOIN_MESSAGE);
    assert.deepEqual(sent[0]?.fallback, JOIN_MESSAGE);
    assert.equal(sent[0]?.values?.user, "<@42>");
    assert.equal(sent[0]?.values?.memberCount, "128");
  });

  test("a customised greeting is what is sent", async () => {
    const custom = { content: "", embeds: [{ title: "Hello {username}", description: "{memberCount} members" }] };
    const { ctx, sent } = fakeCtx(resolve({ join: { channel: CHANNEL, message: custom } }));
    await events.memberJoin({ ...guildMember, guild: ctx.guild }, ctx);
    assert.equal(sent[0]?.body.embeds[0]?.title, "Hello {username}");
  });

  test("nothing is posted without a channel, and the direct message needs switching on", async () => {
    const { ctx, sent } = fakeCtx(resolve({}));
    await events.memberJoin({ ...guildMember, guild: ctx.guild }, ctx);
    assert.equal(sent.length, 0);
  });

  test("the direct message goes to the member's user", async () => {
    const { ctx, sent } = fakeCtx(resolve({ leave: { sendDm: true, dm: "Bye" } }));
    const gone = { ...guildMember, guild: ctx.guild };
    await events.memberLeave(gone, ctx);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.target, gone.user);
    assert.equal(sent[0]?.body.content, "Bye");
    assert.deepEqual(sent[0]?.fallback, LEAVE_DM);
  });
});
