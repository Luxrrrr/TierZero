import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/group-store.js");
const groups = await import("../dist/groups.js");
const rooms = await import("../dist/room-store.js");
const { sweepRooms } = await import("../dist/voice.js");
const { groupComponents, groupModals } = await import("../dist/group-controls.js");
const { groupPanelComponents, groupPanelModals } = await import("../dist/group-panel.js");

let ids = 0;
const GUILD = "900000000000000001";
const PANEL_CHANNEL = "910000000000000001";

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

/** Names every label and message after its key, so a test can tell which one was used. */
const named = () => new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : undefined) });

interface Log {
  replies: { key: string; values: Record<string, unknown> }[];
  sends: { target: string; values: Record<string, unknown>; rows: number }[];
  edits: { id: string; values: Record<string, unknown> }[];
  scheduled: string[];
  cancelled: string[];
  archived: string[];
  added: string[];
  deletedChannels: string[];
}

function world() {
  const log: Log = { replies: [], sends: [], edits: [], scheduled: [], cancelled: [], archived: [], added: [], deletedChannels: [] };
  const cache = new Map<string, any>();

  const nextId = () => `95000000000${String(++ids).padStart(7, "0")}`;

  const voiceChannel = (name: string, userLimit = 0) => {
    const channel: any = {
      id: nextId(),
      name,
      userLimit,
      isVoiceBased: () => true,
      isTextBased: () => false,
      members: new Map<string, any>(),
      permissionOverwrites: { edit: async () => undefined },
      setName: async (value: string) => void (channel.name = value),
      setUserLimit: async (value: number) => void (channel.userLimit = value),
      delete: async () => {
        cache.delete(channel.id);
        log.deletedChannels.push(channel.id);
      },
    };
    cache.set(channel.id, channel);
    return channel;
  };

  const thread = (name: string) => {
    const made: any = {
      id: nextId(),
      name,
      isThread: () => true,
      isTextBased: () => true,
      members: { add: async (id: string) => void log.added.push(id), remove: async () => undefined },
      messages: { fetch: async (id: string) => ({ id }) },
      setArchived: async () => void log.archived.push(made.id),
      setName: async () => undefined,
    };
    cache.set(made.id, made);
    return made;
  };

  const panelChannel: any = {
    id: PANEL_CHANNEL,
    type: ChannelType.GuildText,
    isVoiceBased: () => false,
    isTextBased: () => true,
    threads: { create: async (options: { name: string }) => thread(options.name) },
    messages: { fetch: async () => null, delete: async () => undefined },
  };
  cache.set(PANEL_CHANNEL, panelChannel);

  const guild: any = {
    id: GUILD,
    maximumBitrate: 96000,
    channels: { cache, create: async (options: { name: string; userLimit?: number }) => voiceChannel(options.name, options.userLimit), fetch: async (id: string) => cache.get(id) ?? null },
    members: { me: undefined, cache: new Map(), fetch: async () => null },
    roles: { everyone: {} },
  };

  const settings: any = {
    messages: { groupControls: {}, groupClosed: {}, groupAnnouncement: {}, groupReplies: named(), groupRefusals: named(), rooms: named(), roomRefusals: named() },
    voice: { labels: named() },
    groups: {
      labels: named(),
      enabled: true,
      joinTime: 60_000,
      managerRoles: [],
      panels: [
        {
          id: "panel1",
          channel: PANEL_CHANNEL,
          options: [
            { id: "opt1", label: "LFG", name: "{user}'s group", privacy: "open", userLimit: 4, game: "Valorant", askGame: false, announceMode: "never" },
            { id: "opt3", label: "Ask", name: "{user}'s group", privacy: "open", userLimit: 0, game: "Valorant", askGame: true, announceMode: "never" },
            { id: "opt2", label: "Closed", name: "{user}'s closed", privacy: "private", userLimit: 0, announceMode: "never" },
          ],
        },
      ],
    },
  };

  const ctx: any = {
    guild,
    settings,
    reply: async (_i: unknown, body: unknown, values: Record<string, unknown>) => {
      log.replies.push({ key: String(body), values });
      return true;
    },
    send: async (target: { id: string }, _body: unknown, values: Record<string, unknown>, options: { rows?: unknown[] }) => {
      log.sends.push({ target: target.id, values, rows: options.rows?.length ?? 0 });
      return { id: nextId() };
    },
    edit: async (message: { id: string }, _body: unknown, values: Record<string, unknown>) => {
      log.edits.push({ id: message.id, values });
      return {};
    },
    tasks: {
      schedule: async (name: string) => void log.scheduled.push(name),
      reschedule: async (name: string) => void log.scheduled.push(name),
      cancel: async (name: string) => void log.cancelled.push(name),
    },
  };

  const member = (id: string, connectedTo?: any) => {
    const made: any = {
      id,
      displayName: `User ${id.slice(-2)}`,
      user: { id, username: `user${id.slice(-2)}`, bot: false },
      roles: { cache: new Map() },
      permissions: { has: () => false },
      voice: {
        channelId: connectedTo?.id ?? null,
        setChannel: async (channel: any) => {
          made.voice.channelId = channel.id;
          channel.members.set(id, made);
        },
        disconnect: async () => undefined,
      },
    };
    if (connectedTo) connectedTo.members.set(id, made);
    guild.members.cache.set(id, made);
    return made;
  };

  const press = (owner: any) => ({
    user: owner.user,
    member: owner,
    deferred: true,
    replied: false,
    deferReply: async () => undefined,
    deleteReply: async () => undefined,
  });

  return { ctx, log, guild, member, press, voiceChannel, cache };
}

const replyKeys = (log: Log) => log.replies.map((entry) => entry.key);

describe("starting a group", () => {
  test("moves a member who is in a voice channel and starts the thread at once", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000001", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");

    const group = await store.groupOfOwner(GUILD, owner.id);
    assert.equal(group?.status, "active");
    assert.ok(group?.threadId);
    assert.equal(w.guild.channels.cache.get(group!.voiceChannelId).userLimit, 4);
    assert.equal(w.log.sends.length, 1);
    assert.equal(w.log.sends[0]!.rows, 4);
    assert.deepEqual(w.log.added, [owner.id]);
    assert.deepEqual(replyKeys(w.log), ["ready"]);
    assert.equal(w.log.replies[0]!.values.game, "Valorant");
    assert.equal(group!.game, "Valorant");
    assert.equal(w.guild.channels.cache.get(group!.voiceChannelId).name, `${owner.displayName}'s group - Valorant`);
  });

  test("uses the game the member typed in place of the option's", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000021", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1", "Apex Legends");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    assert.equal(group.game, "Apex Legends");
    assert.equal(w.guild.channels.cache.get(group.voiceChannelId).name, `${owner.displayName}'s group - Apex Legends`);
    assert.equal(w.log.replies[0]!.values.game, "Apex Legends");
  });

  test("leaves the name alone when the member typed no game", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000022", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1", "");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    assert.equal(group.game, "");
    assert.equal(w.guild.channels.cache.get(group.voiceChannelId).name, `${owner.displayName}'s group`);
  });

  test("an option that asks shows the form, and one that does not starts at once", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000023", lobby);
    const shown: unknown[] = [];
    const press = { ...w.press(owner), showModal: async (form: unknown) => void shown.push(form) };

    await groupPanelComponents.groupStart!(press as never, { rest: "panel1:opt3", ctx: w.ctx } as never);
    assert.equal(shown.length, 1);
    assert.equal(await store.groupOfOwner(GUILD, owner.id), null);

    await groupPanelComponents.groupStart!(press as never, { rest: "panel1:opt1", ctx: w.ctx } as never);
    assert.equal(shown.length, 1);
    assert.ok(await store.groupOfOwner(GUILD, owner.id));
  });

  test("the form's answer starts the group with that game", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000024", lobby);
    const submit = { ...w.press(owner), fields: { getTextInputValue: () => "  Deep  Rock " } };
    await groupPanelModals.groupStartGame!(submit as never, { rest: "panel1:opt3", ctx: w.ctx } as never);
    assert.equal((await store.groupOfOwner(GUILD, owner.id))?.game, "Deep Rock");
  });

  test("waits for a member who is not in a voice channel, and starts the thread when they arrive", async () => {
    const w = world();
    const owner = w.member("960000000000000002");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");

    const waiting = await store.groupOfOwner(GUILD, owner.id);
    assert.equal(waiting?.status, "waiting");
    assert.deepEqual(replyKeys(w.log), ["joinPrompt"]);
    assert.match(String(w.log.replies[0]!.values.deadline), /^<t:\d+:R>$/);
    assert.ok(w.log.scheduled.includes("groupDeadline"));

    const voice = w.guild.channels.cache.get(waiting!.voiceChannelId);
    voice.members.set(owner.id, owner);
    await groups.groupMemberJoined(w.ctx, owner, voice.id);

    assert.equal((await store.groupById(GUILD, waiting!.id))?.status, "active");
    assert.equal(w.log.sends.length, 1);
    assert.deepEqual(replyKeys(w.log), ["joinPrompt", "ready"]);
    assert.ok(w.log.cancelled.includes("groupDeadline"));
  });

  test("moves a waiting owner into their channel when they join some other voice channel", async () => {
    const w = world();
    const owner = w.member("960000000000000003");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const elsewhere = w.voiceChannel("Elsewhere");
    owner.voice.channelId = elsewhere.id;
    await groups.groupMemberJoined(w.ctx, owner, elsewhere.id);
    const group = await store.groupOfOwner(GUILD, owner.id);
    assert.equal(owner.voice.channelId, group!.voiceChannelId);
  });

  test("locks the channel of a private option", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000004", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt2");
    assert.equal((await store.groupOfOwner(GUILD, owner.id))?.isPrivate, true);
  });

  test("refuses a second group for the same member", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000005", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    assert.deepEqual(replyKeys(w.log), ["ready", "alreadyHave"]);
    assert.equal((await store.groupsOf(GUILD)).filter((g) => g.ownerId === owner.id).length, 1);
  });

  test("says so when the option was removed after the panel was posted", async () => {
    const w = world();
    const owner = w.member("960000000000000006");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:gone");
    assert.deepEqual(replyKeys(w.log), ["optionGone"]);
  });

  test("does nothing while the feature is off", async () => {
    const w = world();
    w.ctx.settings.groups.enabled = false;
    const owner = w.member("960000000000000007");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    assert.deepEqual(replyKeys(w.log), ["disabled"]);
    assert.equal(await store.groupOfOwner(GUILD, owner.id), null);
  });

  test("removes the voice channel again when the thread cannot be made", async () => {
    const w = world();
    w.guild.channels.cache.get(PANEL_CHANNEL).threads.create = async () => {
      throw new Error("Missing Permissions");
    };
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000008", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    assert.deepEqual(replyKeys(w.log), ["threadFailed"]);
    assert.equal(await store.groupOfOwner(GUILD, owner.id), null);
    assert.equal(w.log.deletedChannels.length, 1);
  });
});

describe("ending a group", () => {
  test("deletes the voice channel, closes the controls and archives the thread", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000009", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;

    await groups.endGroup(w.ctx, group, "done");

    assert.equal(await store.groupById(GUILD, group.id), null);
    assert.deepEqual(w.log.deletedChannels, [group.voiceChannelId]);
    assert.deepEqual(w.log.archived, [group.threadId]);
    assert.equal(w.log.edits.length, 1);
    assert.ok(w.log.cancelled.includes("groupTidy"));
  });

  test("takes everyone out of the voice channel before deleting it", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000031", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    const voice = w.guild.channels.cache.get(group.voiceChannelId);
    const order: string[] = [];
    owner.voice.disconnect = async () => void order.push("disconnect");
    const remove = voice.delete;
    voice.delete = async (reason: string) => {
      order.push("delete");
      await remove(reason);
    };
    await groups.endGroup(w.ctx, group, "done");
    assert.deepEqual(order, ["disconnect", "delete"]);
  });

  test("a voice channel Discord would not delete stays on record, and the sweep removes it later", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000032", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    const voice = w.guild.channels.cache.get(group.voiceChannelId);
    const remove = voice.delete;
    voice.delete = async () => {
      throw Object.assign(new Error("Missing Access"), { code: 50001 });
    };
    await groups.endGroup(w.ctx, group, "done");
    assert.ok(await rooms.roomByChannel(GUILD, voice.id));

    voice.members.clear();
    voice.delete = remove;
    await prisma.voiceRoom.update({ where: { channelId: voice.id }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    await sweepRooms(w.ctx);
    assert.equal(await rooms.roomByChannel(GUILD, voice.id), null);
    assert.ok(w.log.deletedChannels.includes(voice.id));
  });

  test("a group whose owner never came is removed once the time is up, and not before", async () => {
    const w = world();
    const owner = w.member("960000000000000010");
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;

    await groups.tidyGroup(w.ctx, group, Date.now());
    assert.ok(await store.groupById(GUILD, group.id));

    await groups.tidyGroup(w.ctx, group, group.joinBy.getTime() + 1);
    assert.equal(await store.groupById(GUILD, group.id), null);
    assert.equal(w.log.deletedChannels.length, 1);
    assert.deepEqual(replyKeys(w.log), ["joinPrompt", "expired"]);
  });

  test("an active group is kept while someone is in it and ended once it is empty", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000011", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    const voice = w.guild.channels.cache.get(group.voiceChannelId);
    const later = Date.now() + 10 * 60_000;

    await groups.tidyGroup(w.ctx, group, later);
    assert.ok(await store.groupById(GUILD, group.id));

    voice.members.clear();
    await groups.tidyGroup(w.ctx, group, later);
    assert.equal(await store.groupById(GUILD, group.id), null);
  });

  test("a group whose voice channel was deleted by hand is ended by the sweep", async () => {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member("960000000000000012", lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    w.guild.channels.cache.delete(group.voiceChannelId);

    await groups.sweepGroups(w.ctx);
    assert.equal(await store.groupById(GUILD, group.id), null);
  });
});

describe("changing the game", () => {
  async function started() {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member(`97100000000000${String(++ids).padStart(4, "0")}`, lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    const voice = w.guild.channels.cache.get(group.voiceChannelId);
    w.log.replies.length = 0;
    w.log.edits.length = 0;
    return { w, group, voice, owner };
  }
  const submit = (w: ReturnType<typeof world>, who: any, text: string) => ({ ...w.press(who), fields: { getTextInputValue: () => text } });

  test("swaps the game in the name and shows it in the controls", async () => {
    const { w, group, voice, owner } = await started();
    await groupModals.groupGame!(submit(w, owner, "Apex Legends") as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.equal((await store.groupById(GUILD, group.id))?.game, "Apex Legends");
    assert.equal(voice.name, `${owner.displayName}'s group - Apex Legends`);
    assert.deepEqual(replyKeys(w.log), ["gameChanged"]);
    assert.equal(w.log.edits.at(-1)!.values.game, "Apex Legends");
  });

  test("keeps a name the owner edited and only swaps the game in it", async () => {
    const { w, group, voice, owner } = await started();
    voice.name = "Ranked grind - Valorant";
    await groupModals.groupGame!(submit(w, owner, "Overwatch") as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.equal(voice.name, "Ranked grind - Overwatch");
  });

  test("does not take an empty game", async () => {
    const { w, group, owner } = await started();
    await groupModals.groupGame!(submit(w, owner, "   ") as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["changeFailed"]);
    assert.equal((await store.groupById(GUILD, group.id))?.game, "Valorant");
  });

  test("is for the owner and managers only", async () => {
    const { w, group } = await started();
    const other = w.member(`97200000000000${String(++ids).padStart(4, "0")}`);
    await groupModals.groupGame!(submit(w, other, "Apex") as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["notManager"]);
    assert.equal((await store.groupById(GUILD, group.id))?.game, "Valorant");
  });

  test("the button opens a form holding the current game", async () => {
    const { w, group, owner } = await started();
    let form: any;
    const press = { ...w.press(owner), showModal: async (made: unknown) => void (form = made) };
    await groupComponents.groupGame!(press as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.equal(form.toJSON().components[0].components[0].value, "Valorant");
  });
});

describe("joining and leaving from the announcement", () => {
  async function started(userLimit = 4) {
    const w = world();
    const lobby = w.voiceChannel("Lobby");
    const owner = w.member(`97000000000000${String(++ids).padStart(4, "0")}`, lobby);
    await groups.startGroup(w.ctx, w.press(owner) as never, "panel1:opt1");
    const group = (await store.groupOfOwner(GUILD, owner.id))!;
    const voice = w.guild.channels.cache.get(group.voiceChannelId);
    voice.userLimit = userLimit;
    w.log.replies.length = 0;
    w.log.added.length = 0;
    return { w, group, voice, owner, lobby };
  }

  test("a member is added to the thread and moved into the voice channel", async () => {
    const { w, group, voice, lobby } = await started();
    const guest = w.member(`98000000000000${String(++ids).padStart(4, "0")}`, lobby);
    await groupComponents.groupJoin!(w.press(guest) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["joinedGroup"]);
    assert.deepEqual(w.log.added, [guest.id]);
    assert.equal(guest.voice.channelId, voice.id);
  });

  test("a member outside voice is added to the thread and told where the channel is", async () => {
    const { w, group, voice } = await started();
    const guest = w.member(`98000000000000${String(++ids).padStart(4, "0")}`);
    await groupComponents.groupJoin!(w.press(guest) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(w.log.added, [guest.id]);
    assert.equal(w.log.replies[0]!.values.room, `<#${voice.id}>`);
  });

  test("a full group refuses, and a private one does", async () => {
    const { w, group, voice, lobby } = await started(1);
    const guest = w.member(`98000000000000${String(++ids).padStart(4, "0")}`, lobby);
    await groupComponents.groupJoin!(w.press(guest) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["groupFull"]);

    voice.userLimit = 0;
    await store.setPrivate(group.id, true);
    await groupComponents.groupJoin!(w.press(guest) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["groupFull", "groupPrivate"]);
    assert.deepEqual(w.log.added, []);
  });

  test("the owner cannot leave their own group", async () => {
    const { w, group, owner } = await started();
    await groupComponents.groupLeave!(w.press(owner) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["ownerCannotLeave"]);
  });

  test("a control for a group that ended says so", async () => {
    const { w, group } = await started();
    await store.deleteGroup(group.id);
    const other = w.member(`98000000000000${String(++ids).padStart(4, "0")}`);
    await groupComponents.groupJoin!(w.press(other) as never, { rest: String(group.id), ctx: w.ctx } as never);
    assert.deepEqual(replyKeys(w.log), ["groupGone"]);
  });
});
