import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariablesToMessage, emptyEmbed, parseMessage, type MessageBody } from "@tier0/core";
import utility from "../dist/index.js";
import { PING_STARTING } from "../dist/messages.js";

const registry = new ModuleRegistry();
registry.register(utility);

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("utility", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value;
}

/** Fills a message the way the bot does before it is sent. */
function render(body: MessageBody, shared: Record<string, string>, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(body, { ...shared, ...strings }));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors[0]?.message);
  return parsed.value;
}

interface Replied {
  body: MessageBody;
  values: Record<string, string | number>;
  options?: { ephemeral?: boolean };
}
let replied: Replied[];
let direct: unknown[];

function context(stored: unknown = {}, custom?: (values: Record<string, string | number>) => unknown, joined: number | null = 1_700_000_000_000) {
  return {
    settings: settingsFor(stored),
    client: { ws: { ping: 61 } },
    guild: {
      name: "Northwind",
      memberCount: 12_345,
      createdTimestamp: 1_600_000_000_000,
      iconURL: () => "https://cdn.example/icon.png",
      channels: { cache: { size: 34 } },
      roles: { cache: { size: 18 } },
      members: { fetch: async () => (joined === null ? null : { joinedTimestamp: joined }) },
    },
    customReply: custom,
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, options?: Replied["options"]) => {
      replied.push({ body, values, options });
      return true;
    },
  } as never;
}

const command = (name: string) => utility.commands!.find((entry) => entry.name === name)!;
const interaction = () =>
  ({
    createdTimestamp: Date.now() - 84,
    options: { getUser: () => null },
    user: { username: "ada", displayAvatarURL: () => "https://cdn.example/ada.png", createdTimestamp: 1_500_000_000_000 },
    reply: async (reply: unknown) => {
      direct.push(reply);
    },
  }) as never;

const SHARED = { server: "Northwind", members: "12,345", "server.icon": "https://cdn.example/icon.png?size=256" };
const fresh = () => {
  replied = [];
  direct = [];
};

describe("/ping", () => {
  test("answers as it always has, privately", async () => {
    fresh();
    await command("ping").run(interaction(), context());
    assert.deepEqual(replied[0]?.body, PING_STARTING);
    assert.equal(replied[0]?.options, undefined, "private is the default");
    const filled = render(PING_STARTING, {}, replied[0]!.values);
    assert.match(filled.embeds[0]?.description ?? "", /^Responding in \d+ms, gateway at 61ms\.$/);
  });

  test("starts out as an info embed with no text above it", () => {
    assert.equal(PING_STARTING.content, "");
    assert.equal(PING_STARTING.embeds.length, 1);
    assert.equal(PING_STARTING.embeds[0]?.color, REPLY_COLOR.info);
    assert.equal(PING_STARTING.embeds[0]?.description, "Responding in {roundtrip}ms, gateway at {gateway}ms.");
  });

  test("an owner's own reply is sent as it was, still privately", async () => {
    fresh();
    await command("ping").run(interaction(), context({}, () => ({ content: "pong" })));
    assert.deepEqual(direct, [{ content: "pong", flags: 64 }]);
    assert.equal(replied.length, 0);
  });
});

describe("/serverinfo", () => {
  test("shows the embed it always showed", async () => {
    fresh();
    await command("serverinfo").run(interaction(), context());
    assert.equal(replied[0]?.options?.ephemeral, false);
    const [embed] = render(replied[0]!.body, SHARED, replied[0]!.values).embeds;
    assert.deepEqual(embed, {
      ...emptyEmbed(),
      title: "Northwind",
      color: REPLY_COLOR.info,
      thumbnailUrl: "https://cdn.example/icon.png",
      fields: [
        { name: "Members", value: "12345", inline: true },
        { name: "Channels", value: "34", inline: true },
        { name: "Roles", value: "18", inline: true },
        { name: "Created", value: "<t:1600000000:D>", inline: false },
      ],
    });
  });

  test("is the colour every information reply has", async () => {
    fresh();
    await command("serverinfo").run(interaction(), context());
    assert.equal(render(replied[0]!.body, SHARED, replied[0]!.values).embeds[0]?.color, REPLY_COLOR.info);
  });
});

describe("/userinfo", () => {
  test("shows the embed it always showed", async () => {
    fresh();
    await command("userinfo").run(interaction(), context());
    const [embed] = render(replied[0]!.body, SHARED, replied[0]!.values).embeds;
    assert.deepEqual(embed, {
      ...emptyEmbed(),
      title: "ada",
      color: REPLY_COLOR.info,
      thumbnailUrl: "https://cdn.example/ada.png",
      fields: [
        { name: "Account created", value: "<t:1500000000:D>", inline: true },
        { name: "Joined server", value: "<t:1700000000:D>", inline: true },
      ],
    });
  });

  test("leaves the join date out for someone who is not in the server, as before", async () => {
    fresh();
    await command("userinfo").run(interaction(), context({}, undefined, null));
    const [embed] = render(replied[0]!.body, SHARED, replied[0]!.values).embeds;
    assert.deepEqual(embed?.fields.map((field) => field.name), ["Account created"]);
  });

  test("an owner's reply gets Unknown for that person", async () => {
    fresh();
    const seen: Record<string, string | number>[] = [];
    await command("userinfo").run(interaction(), context({}, (values) => (seen.push(values), { content: "x" }), null));
    assert.equal(seen[0]?.joined, "Unknown");
    assert.deepEqual(direct.length, 1);
  });
});
