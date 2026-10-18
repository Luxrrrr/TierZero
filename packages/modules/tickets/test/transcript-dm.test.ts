import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OBSERVER, ada, grace, mod, open, prisma, refusalText, setup, tickets } from "./ticket-world.ts";
import { GUILD, interaction, member, message, user, type FakeChannel, type World } from "./fake-discord.ts";

/**
 * Who is sent the transcript when a ticket closes, in which file, and the
 * rating request that travels with the opener's copy.
 */

const dana = user("130000000000000041", "dana");
const erin = user("130000000000000042", "erin");
const helper = user("130000000000000043", "helperbot", true);
const watcher = user("130000000000000044", "watcher");
const manager = user("130000000000000045", "manager");
const actor = { userId: grace.id, name: "Grace", avatarUrl: null };

/** Everyone who could be in a ticket: a member, one with DMs closed, a bot, an observer and a manager. */
async function ticketWith(w: World) {
  w.addMember(member(dana));
  w.addMember(member(erin));
  w.addMember(member(helper));
  w.addMember(member(watcher, [OBSERVER]));
  w.addMember(member(manager, [], { has: () => true }));
  const { row, channel } = await open(w);
  await tickets.events!.messageCreate!(message(channel.id, ada, "still broken") as never, w.ctx);
  return { row, channel };
}

async function addByEvent(w: World, ticketId: number, who: typeof dana) {
  await mod.changeTicketMember(w.ctx, ticketId, { userId: who.id, action: "add" }, actor);
}

/** Members who were given the channel without the add command, as a role or an integration can. */
function letIn(channel: FakeChannel, ...people: (typeof dana)[]) {
  for (const person of people) void channel.permissionOverwrites.edit(person.id, { ViewChannel: true }, { type: 1 });
}

const close = (w: World, rowId: number, channelId: string) =>
  tickets.components!.close!(interaction(ada, { channelId }) as never, { rest: String(rowId), ctx: w.ctx });

const filesOf = (w: World, userId: string) =>
  ((w.dms.get(userId)?.[0]?.options.files ?? []) as { name: string; attachment: Buffer }[]).map((file) => ({ name: file.name, text: file.attachment.toString("utf8") }));

const recipients = (w: World) => [...w.dms.keys()].sort();

describe("who is sent the transcript", () => {
  test("nobody by default", async () => {
    const w = setup();
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    assert.deepEqual(recipients(w), []);
  });

  test("only the opener when that is chosen, whoever else is in the ticket", async () => {
    const w = setup({ transcripts: { sendTo: "opener" } });
    const { row, channel } = await ticketWith(w);
    await addByEvent(w, row.id, dana);
    await close(w, row.id, channel.id);
    assert.deepEqual(recipients(w), [ada.id]);
  });

  test("everyone chosen: the opener and the members added, not staff and not bots", async () => {
    const w = setup({ transcripts: { sendTo: "everyone" } }, {}, { dmClosed: [erin.id] });
    const { row, channel } = await ticketWith(w);
    await addByEvent(w, row.id, dana);
    await addByEvent(w, row.id, erin);
    letIn(channel, helper, watcher, manager);
    await close(w, row.id, channel.id);

    assert.deepEqual(recipients(w), [ada.id, dana.id].sort(), "erin has DMs closed, and the bot, observer and manager are left out");
  });

  test("a handler let into the ticket is staff and is not sent it", async () => {
    const w = setup({ transcripts: { sendTo: "everyone" } });
    const { row, channel } = await ticketWith(w);
    letIn(channel, grace);
    await close(w, row.id, channel.id);
    assert.deepEqual(recipients(w), [ada.id]);
  });

  test("someone added and then removed is not sent it", async () => {
    const w = setup({ transcripts: { sendTo: "everyone" } });
    const { row, channel } = await ticketWith(w);
    await addByEvent(w, row.id, dana);
    await mod.changeTicketMember(w.ctx, row.id, { userId: dana.id, action: "remove" }, actor);
    await close(w, row.id, channel.id);
    assert.deepEqual(recipients(w), [ada.id]);
  });

  test("a member with direct messages closed does not stop the close or the others", async () => {
    const w = setup({ transcripts: { sendTo: "everyone" } }, {}, { dmClosed: [dana.id] });
    const { row, channel } = await ticketWith(w);
    await addByEvent(w, row.id, dana);
    await close(w, row.id, channel.id);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).status, "closed");
    assert.deepEqual(recipients(w), [ada.id]);
  });
});

describe("the transcript file", () => {
  test("is the web page by default, named from the file name setting", async () => {
    const w = setup({ transcripts: { sendTo: "opener" } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const files = filesOf(w, ada.id);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.name, `ticket-${(row.number ?? row.id)}.html`);
    assert.match(files[0]!.text, /^<!doctype html>/);
    assert.match(files[0]!.text, /still broken/);
  });

  test("is a text file when that is chosen", async () => {
    const w = setup({ transcripts: { sendTo: "opener", format: "text" } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const files = filesOf(w, ada.id);
    assert.deepEqual(files.map((file) => file.name), [`ticket-${(row.number ?? row.id)}.txt`]);
    assert.doesNotMatch(files[0]!.text, /<html/);
  });

  test("is both when that is chosen", async () => {
    const w = setup({ transcripts: { sendTo: "opener", format: "both" }, labels: { transcript: { fileName: "case-{number}.log" } } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    assert.deepEqual(
      filesOf(w, ada.id).map((file) => file.name),
      [`case-${(row.number ?? row.id)}.html`, `case-${(row.number ?? row.id)}.log`],
    );
  });

  test("falls back to the text file when the messages are not stored", async () => {
    const w = setup({ transcripts: { sendTo: "opener", store: false } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    assert.deepEqual(filesOf(w, ada.id).map((file) => file.name), [`ticket-${(row.number ?? row.id)}.txt`]);
  });
});

describe("the rating with the transcript", () => {
  const stars = "★★★★☆";

  test("the opener gets one message with the file and the buttons, the others only the file", async () => {
    const w = setup({ transcripts: { sendTo: "everyone" }, ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await addByEvent(w, row.id, dana);
    await close(w, row.id, channel.id);

    assert.equal(w.dms.get(ada.id)?.length, 1, "one message, not two");
    const together = w.dms.get(ada.id)![0]!;
    assert.equal(filesOf(w, ada.id).length, 1);
    const buttons = (together.options.rows as { toJSON(): { components: unknown[] } }[])[0]!.toJSON().components;
    assert.equal(buttons.length, 5);
    assert.equal(together.body.embeds.length, 2, "the transcript text and the rating request");

    assert.equal(w.dms.get(dana.id)?.length, 1);
    assert.equal(w.dms.get(dana.id)![0]!.options.rows, undefined);
  });

  test("a rating alone is still sent when the transcript is not", async () => {
    const w = setup({ ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    assert.equal(w.dms.get(ada.id)?.length, 1);
    assert.equal(filesOf(w, ada.id).length, 0);
    assert.ok(w.dms.get(ada.id)![0]!.options.rows);
  });

  test("the message is edited when a rating is picked: buttons off, the rating and stars shown", async () => {
    const w = setup({ transcripts: { sendTo: "opener" }, ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const dm = w.dms.get(ada.id)![0]!.message!;

    const press = interaction(ada, { message: dm });
    await tickets.components!.rate!(press as never, { rest: `${GUILD}:${row.id}:4`, ctx: w.ctx });

    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).rating, 4);
    assert.equal(press.modals.length, 1, "the comment form still opens");
    assert.equal(dm.options?.rows, undefined, "no buttons left");
    const embeds = dm.body!.embeds;
    assert.equal(embeds.length, 3, "the transcript text and the request stay, the rating is added");
    assert.equal(embeds[2]!.description, "You rated this {rating} out of 5\n{stars}", "the notice, filled in from the values below");
    assert.equal(dm.values?.rating, 4);
    assert.equal(dm.values?.stars, stars);
  });

  test("the edit keeps only the request when the rating came alone", async () => {
    const w = setup({ ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const dm = w.dms.get(ada.id)![0]!.message!;
    await tickets.components!.rate!(interaction(ada, { message: dm }) as never, { rest: `${GUILD}:${row.id}:2`, ctx: w.ctx });
    assert.equal(dm.body!.embeds.length, 2);
    assert.equal(dm.values?.rating, 2);
    assert.equal(dm.values?.stars, "★★☆☆☆");
  });

  test("the reworded message is used", async () => {
    const w = setup({
      ratings: {
        enabled: true,
        rated: { content: "", embeds: [{ description: "Rated {rating}: {stars}" }], buttons: [], selects: [], reactions: [] },
      },
    });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const dm = w.dms.get(ada.id)![0]!.message!;
    await tickets.components!.rate!(interaction(ada, { message: dm }) as never, { rest: `${GUILD}:${row.id}:5`, ctx: w.ctx });
    assert.equal(dm.body!.embeds.at(-1)!.description, "Rated {rating}: {stars}");
    assert.equal(dm.values?.stars, "★".repeat(5));
  });

  test("a second press is told plainly and changes nothing", async () => {
    const w = setup({ ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const dm = w.dms.get(ada.id)![0]!.message!;
    await tickets.components!.rate!(interaction(ada, { message: dm }) as never, { rest: `${GUILD}:${row.id}:4`, ctx: w.ctx });
    const after = dm.body;

    const second = interaction(ada, { message: dm });
    await tickets.components!.rate!(second as never, { rest: `${GUILD}:${row.id}:1`, ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /already rated/);
    assert.equal(second.modals.length, 0);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).rating, 4);
    assert.equal(dm.body, after);
  });

  test("the rating is kept and the form opens when the message cannot be edited", async () => {
    const w = setup({ ratings: { enabled: true } });
    const { row, channel } = await ticketWith(w);
    await close(w, row.id, channel.id);
    const dm = w.dms.get(ada.id)![0]!.message!;
    (w.ctx as unknown as { edit: () => Promise<null> }).edit = async () => null;
    const press = interaction(ada, { message: dm });
    await tickets.components!.rate!(press as never, { rest: `${GUILD}:${row.id}:3`, ctx: w.ctx });
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).rating, 3);
    assert.equal(press.modals.length, 1);
  });
});

