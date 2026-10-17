import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, type FieldDescriptor, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000040";
const CHANNEL = "123456789012345678";
const BAD_URL = "http://127.0.0.1:9/feed.xml";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: feeds } = await import("../dist/index.js");
const { DEFAULT_FAILURES, FeedFailure, describeFailure } = await import("../dist/failures.js");
const { DEFAULT_LABELS, AMBIGUOUS, NO_MATCH, STATUS_EMPTY, STATUS_REPLY } = await import("../dist/labels.js");
const { parseFeed } = await import("../dist/parse.js");
const { parseSteamNews } = await import("../dist/steam.js");
const { safeFetch } = await import("../dist/net.js");

const registry = new ModuleRegistry();
registry.register(feeds);

interface Told {
  body: MessageBody;
  values: Record<string, string | number>;
  fallback?: MessageBody;
}
let told: Told[];
let edited: unknown[];

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("feeds", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value;
}

const feed = (name: string, url = BAD_URL) => ({ name, url, channel: CHANNEL });

function context(stored: unknown = {}, customReply?: (values: Record<string, string | number>) => unknown) {
  return {
    settings: settingsFor(stored),
    guild: { id: GUILD, channels: { cache: { get: () => ({ isTextBased: () => true }) } } },
    tasks: { cancel: async () => 0, schedule: async () => undefined },
    customReply,
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, options?: { fallback?: MessageBody }) => {
      told.push({ body, values, fallback: options?.fallback });
      return true;
    },
  } as never;
}

const command = feeds.commands![0]!;
const interaction = (sub: string, source = "", count: number | null = null) =>
  ({
    options: {
      getSubcommand: () => sub,
      getString: () => source,
      getInteger: () => count,
    },
    deferReply: async () => undefined,
    editReply: async (reply: unknown) => {
      edited.push(reply);
    },
  }) as never;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Feeds test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  told = [];
  edited = [];
  await prisma.feedCursor.deleteMany();
});

describe("the failure descriptions", () => {
  test("keep the wording the module has always recorded", () => {
    assert.equal(DEFAULT_FAILURES.rateLimited, "the site is limiting how often it can be checked (status 429). Try a longer check interval");
    assert.equal(describeFailure(new FeedFailure("siteStatus", { status: 503 })), "the site answered with status 503");
    assert.equal(describeFailure(new FeedFailure("steamStatus", { status: 500 })), "Steam answered with status 500");
    assert.equal(describeFailure("not an error"), "something went wrong");
  });

  test("name a network error for what the owner can do, and never pass on the system's own text", () => {
    const system = (code: string) => Object.assign(new Error(`getaddrinfo ${code} retro-corner.example`), { code });
    assert.equal(describeFailure(system("ENOTFOUND")), "that address could not be found. Check it is spelled right");
    assert.equal(describeFailure(system("ECONNREFUSED")), DEFAULT_FAILURES.refused);
    assert.equal(describeFailure(system("ECONNRESET")), DEFAULT_FAILURES.connectionLost);
    assert.equal(describeFailure(system("CERT_HAS_EXPIRED")), DEFAULT_FAILURES.badCertificate);
    assert.equal(describeFailure(system("ERR_TLS_CERT_ALTNAME_INVALID")), DEFAULT_FAILURES.badCertificate);
    assert.equal(describeFailure(new Error("boom")), "something went wrong");
    assert.equal(describeFailure(system("ENOTFOUND"), { ...DEFAULT_FAILURES, notFound: "no such site" }), "no such site");
  });

  test("the layers that throw them still carry the old message", async () => {
    assert.throws(() => parseFeed("<html><body>hi</body></html>"), /did not return an RSS or Atom feed/);
    assert.throws(() => parseSteamNews({ nope: true }), /Steam answered with something unexpected/);
    await assert.rejects(safeFetch("http://127.0.0.1/"), /not on the public internet/);
    await assert.rejects(safeFetch("ftp://example.com/"), /only http and https/);
    await assert.rejects(safeFetch("not a url"), /not a valid address/);
  });

  test("the settings default to those words, and a rewording is used", () => {
    const { labels } = settingsFor() as { labels: { problems: Record<string, string> } };
    assert.deepEqual(labels.problems, DEFAULT_FAILURES);
    const custom = settingsFor({ labels: { problems: { siteStatus: "error {status} from the site" } } }) as typeof labels;
    assert.equal(describeFailure(new FeedFailure("siteStatus", { status: 404 }), custom.labels.problems as never), "error 404 from the site");
    assert.equal(describeFailure(new FeedFailure("timeout"), custom.labels.problems as never), DEFAULT_FAILURES.timeout);
  });

  test("a problem recorded at a check uses the server's wording", async () => {
    await feeds.tasks!.poll!({}, context({ news: { feeds: [feed("Gazette")] }, labels: { problems: { notPublic: "blocked: not public" } } }));
    const cursor = await prisma.feedCursor.findFirst({ where: { guildId: GUILD } });
    assert.equal(cursor?.lastError, "blocked: not public");
  });

  test("and the default wording when nothing was changed", async () => {
    await feeds.tasks!.poll!({}, context({ news: { feeds: [feed("Gazette")] } }));
    const cursor = await prisma.feedCursor.findFirst({ where: { guildId: GUILD } });
    assert.equal(cursor?.lastError, "that address is not on the public internet");
  });
});

describe("/feeds status", () => {
  test("says nothing is watched in the server's own words", async () => {
    await command.run(interaction("status"), context());
    assert.deepEqual(told[0]?.fallback, STATUS_EMPTY);
    assert.equal(told[0]?.body.embeds[0]?.description, "Nothing is being watched yet. Add a feed or a game in the dashboard.");

    told = [];
    await command.run(interaction("status"), context({ replies: { statusEmpty: "Nothing here." } }));
    assert.equal(told[0]?.body.content, "Nothing here.");
  });

  test("lists each source in the three line formats", async () => {
    const stored = { news: { feeds: [feed("Never"), feed("Fine", "http://127.0.0.1:9/b.xml"), feed("Broken", "http://127.0.0.1:9/c.xml")] } };
    const checkedAt = new Date(1_790_000_000_000);
    await prisma.feedCursor.create({ data: { guildId: GUILD, sourceKey: "rss:http://127.0.0.1:9/b.xml", checkedAt } });
    await prisma.feedCursor.create({
      data: { guildId: GUILD, sourceKey: "rss:http://127.0.0.1:9/c.xml", checkedAt, lastError: "the site answered with status 500" },
    });
    await command.run(interaction("status"), context(stored));
    const when = "<t:1790000000:R>";
    assert.deepEqual(told[0]?.fallback, STATUS_REPLY);
    assert.deepEqual(told[0]?.values, {
      lines: ["Never: not checked yet", `Fine: checked ${when}, working`, `Broken: checked ${when}, problem: the site answered with status 500`].join("\n"),
      count: 3,
    });
  });

  test("a feed is tracked per channel, and one checked before that shows what was known of its address", async () => {
    const other = "123456789012345679";
    const stored = { news: { feeds: [feed("Here", "http://127.0.0.1:9/b.xml"), { name: "There", url: "http://127.0.0.1:9/b.xml", channel: other }] } };
    const checkedAt = new Date(1_790_000_000_000);
    await prisma.feedCursor.create({ data: { guildId: GUILD, sourceKey: "rss:http://127.0.0.1:9/b.xml", checkedAt } });
    await prisma.feedCursor.create({
      data: { guildId: GUILD, sourceKey: `rss:http://127.0.0.1:9/b.xml:${other}`, checkedAt, lastError: "the site answered with status 500" },
    });
    await command.run(interaction("status"), context(stored));
    const when = "<t:1790000000:R>";
    assert.equal(told[0]?.values.lines, `Here: checked ${when}, working\nThere: checked ${when}, problem: the site answered with status 500`);
  });

  test("the line formats can be reworded", async () => {
    const stored = {
      news: { feeds: [feed("Never"), feed("Fine", "http://127.0.0.1:9/b.xml")] },
      labels: { statusNever: "{source} - waiting", statusWorking: "{source} - fine ({checked})" },
    };
    await prisma.feedCursor.create({ data: { guildId: GUILD, sourceKey: "rss:http://127.0.0.1:9/b.xml", checkedAt: new Date(1_790_000_000_000) } });
    await command.run(interaction("status"), context(stored));
    assert.equal(told[0]?.values.lines, "Never - waiting\nFine - fine (<t:1790000000:R>)");
  });

  test("cuts a very long list at the length it always did", async () => {
    const many = Array.from({ length: 25 }, (_, i) => feed(`${"n".repeat(70)}${i}`, `http://127.0.0.1:9/${i}.xml`));
    await command.run(interaction("status"), context({ news: { feeds: many } }));
    assert.equal(String(told[0]?.values.lines).length, 1900);
  });
});

describe("/feeds send", () => {
  const stored = { news: { feeds: [feed("Gazette", "http://127.0.0.1:9/a.xml"), feed("Gazette Daily", "http://127.0.0.1:9/b.xml")] } };

  test("says when nothing matches, with what was typed", async () => {
    await command.run(interaction("send", "zzz"), context(stored));
    assert.deepEqual(told[0]?.fallback, NO_MATCH);
    assert.deepEqual(told[0]?.values, { query: "zzz" });
    assert.equal(told[0]?.body.embeds[0]?.description, 'Nothing being watched matches "{query}". /feeds status lists everything.');
  });

  test("lists the sources that matched when several do", async () => {
    await command.run(interaction("send", "gazette"), context(stored));
    assert.deepEqual(told[0]?.fallback, AMBIGUOUS);
    assert.deepEqual(told[0]?.values, { query: "gazette", sources: "Gazette\nGazette Daily" });
  });

  test("keeps the whole message within what it was cut to before", async () => {
    const many = Array.from({ length: 25 }, (_, i) => feed(`Gazette ${"n".repeat(65)} ${i}`, `http://127.0.0.1:9/${i}.xml`));
    await command.run(interaction("send", "gazette"), context({ news: { feeds: many } }));
    const filled = `"gazette" matches more than one source. Use a more specific name:\n${told[0]?.values.sources}`;
    assert.equal(filled.length, 1900);
  });

  test("the reply to a send is the command's own template, and no second copy of it", async () => {
    await command.run(interaction("send", "Daily", 2), context(stored));
    assert.equal(told.length, 1);
    assert.deepEqual(told[0]?.body, command.response!.starting);
    assert.deepEqual(told[0]?.values, {
      posted: 0,
      count: 2,
      source: "Gazette Daily",
      problem: "Stopped because: that address is not on the public internet.",
    });
  });

  test("the sentence for a send that stopped is the server's own", async () => {
    await command.run(interaction("send", "Daily", 1), context({ ...stored, labels: { stopped: "It failed ({error})." } }));
    assert.equal(told[0]?.values.problem, "It failed (that address is not on the public internet).");
  });

  test("an owner's reply to the command still wins, without the flags it may carry", async () => {
    const custom = { content: "Done: {x}", flags: 64 };
    await command.run(interaction("send", "Daily"), context(stored, () => custom));
    assert.equal(told.length, 0);
    assert.deepEqual(edited, [{ content: "Done: {x}" }]);
  });
});

describe("the default look of the replies", () => {
  test("each starts as one embed with no text above it, in the colour of what it says", () => {
    const expected = [
      [STATUS_EMPTY, REPLY_COLOR.info],
      [STATUS_REPLY, REPLY_COLOR.info],
      [NO_MATCH, REPLY_COLOR.error],
      [AMBIGUOUS, REPLY_COLOR.error],
      [command.response!.starting, REPLY_COLOR.success],
    ] as const;
    for (const [body, color] of expected) {
      assert.equal(body.content, "");
      assert.equal(body.embeds.length, 1);
      assert.equal(body.embeds[0]?.color, color);
    }
  });
});

describe("what the dashboard is told", () => {
  const summary = registry.describe().find((entry) => entry.id === "feeds");
  const fields = summary?.schema.fields as Record<string, FieldDescriptor>;

  test("the replies are one collapsible group of compact messages", () => {
    assert.equal(fields.replies?.collapsible, true);
    const messages = Object.values(fields.replies?.fields as Record<string, FieldDescriptor>);
    assert.equal(messages.length, 4);
    assert.ok(messages.every((field) => field.kind === "message" && field.compact === true));
  });

  test("the labels are one collapsible group", () => {
    assert.equal(fields.labels?.collapsible, true);
    const labels = fields.labels?.fields as Record<string, FieldDescriptor>;
    assert.equal(Object.keys(labels.problems?.fields as object).length, 20);
    assert.deepEqual(labels.statusProblem?.placeholders, ["source", "checked", "problem"]);
    assert.equal(labels.statusNever?.default, DEFAULT_LABELS.statusNever);
  });
});
