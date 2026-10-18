import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GENERATED_ID, formLayoutProblems, generatedId, layoutProblems, messageAttachProblems, plainReply, s } from "../dist/index.js";
import type { FieldDescriptor } from "../dist/index.js";

const CHANNEL = "123456789012345678";

function value<T>(result: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
  assert.equal(result.ok, true, "expected parse to succeed");
  return (result as { ok: true; value: T }).value;
}

function errors(result: { ok: boolean; errors?: { path: string; message: string }[] }) {
  assert.equal(result.ok, false, "expected parse to fail");
  return result.errors ?? [];
}

describe("string", () => {
  test("rejects a missing required value", () => {
    assert.equal(s.string().parse(undefined).ok, false);
    assert.equal(s.string().parse("").ok, false);
  });

  test("supplies a default when absent", () => {
    assert.equal(value(s.string({ default: "hi" }).parse(undefined)), "hi");
  });

  test("enforces min and max length", () => {
    assert.equal(s.string({ min: 3 }).parse("ab").ok, false);
    assert.equal(s.string({ max: 3 }).parse("abcd").ok, false);
    assert.equal(value(s.string({ min: 1, max: 3 }).parse("ab")), "ab");
  });

  test("rejects a non-string", () => {
    assert.equal(s.string().parse(42).ok, false);
  });
});

describe("integer", () => {
  test("coerces a numeric string, since form inputs submit strings", () => {
    assert.equal(value(s.integer().parse("15")), 15);
  });

  test("rejects fractions and non-numbers", () => {
    assert.equal(s.integer().parse(1.5).ok, false);
    assert.equal(s.integer().parse("abc").ok, false);
  });

  test("enforces bounds", () => {
    assert.equal(s.integer({ min: 1 }).parse(0).ok, false);
    assert.equal(s.integer({ max: 100 }).parse(101).ok, false);
  });

  test("accepts zero, which is a value and not an absence", () => {
    assert.equal(value(s.integer().parse(0)), 0);
  });
});

describe("boolean", () => {
  test("accepts false, which is a value and not an absence", () => {
    assert.equal(value(s.boolean().parse(false)), false);
  });

  test("rejects a non-boolean", () => {
    assert.equal(s.boolean().parse("yes").ok, false);
  });
});

describe("duration", () => {
  test("converts each unit to milliseconds", () => {
    assert.equal(value(s.duration().parse("30s")), 30_000);
    assert.equal(value(s.duration().parse("15m")), 900_000);
    assert.equal(value(s.duration().parse("2h")), 7_200_000);
    assert.equal(value(s.duration().parse("7d")), 604_800_000);
  });

  test("resolves a default through the same parser", () => {
    assert.equal(value(s.duration({ default: "60s" }).parse(undefined)), 60_000);
  });

  test("rejects an unknown unit or malformed input", () => {
    assert.equal(s.duration().parse("30x").ok, false);
    assert.equal(s.duration().parse("abc").ok, false);
    assert.equal(s.duration().parse("s30").ok, false);
    assert.equal(s.duration().parse("").ok, false);
  });

  test("enforces a ceiling", () => {
    assert.equal(s.duration({ max: "1h" }).parse("2h").ok, false);
    assert.equal(value(s.duration({ max: "1h" }).parse("30m")), 1_800_000);
  });

  test("passes through a value already stored as milliseconds", () => {
    assert.equal(value(s.duration().parse(45_000)), 45_000);
  });

  test("enforces a floor on written input and says it in words", () => {
    const field = s.duration({ min: "1m", max: "28d" });
    const below = field.parse("30s");
    assert.equal(below.ok, false);
    assert.equal(errors(below)[0]?.message, "must be at least 1 minute");
    assert.equal(errors(field.parse("0m"))[0]?.message, "must be at least 1 minute");
    assert.equal(errors(field.parse("29d"))[0]?.message, "must be 28 days or less");
    assert.equal(value(field.parse("1m")), 60_000);
  });

  test("pulls a stored number inside its limits rather than refusing it", () => {
    const field = s.duration({ min: "1m", max: "1h" });
    assert.equal(value(field.parse(0)), 60_000);
    assert.equal(value(field.parse(-5)), 60_000);
    assert.equal(value(field.parse(7_200_000)), 3_600_000);
    assert.equal(value(field.parse(90_000)), 90_000);
  });

  test("never stores a negative or fractional number of milliseconds", () => {
    assert.equal(value(s.duration().parse(-1000)), 0);
    assert.equal(value(s.duration().parse(1500.4)), 1500);
  });

  test("refuses a number that is not one", () => {
    assert.equal(s.duration().parse(Number.NaN).ok, false);
    assert.equal(s.duration().parse(Number.POSITIVE_INFINITY).ok, false);
  });

  test("describes its floor for the dashboard", () => {
    assert.equal(s.duration({ min: "5m" }).describe().min, "5m");
  });
});

describe("snowflake fields", () => {
  test("accepts a well formed id", () => {
    assert.equal(value(s.channel().parse(CHANNEL)), CHANNEL);
    assert.equal(value(s.role().parse(CHANNEL)), CHANNEL);
  });

  test("rejects anything that is not a snowflake", () => {
    assert.equal(s.channel().parse("nope").ok, false);
    assert.equal(s.channel().parse("123").ok, false);
    assert.equal(s.role().parse(1234567890).ok, false);
  });

  test("carries the requested channel types into the descriptor", () => {
    const described = s.channel({ types: ["text", "voice"] }).describe();
    assert.deepEqual(described.types, ["text", "voice"]);
  });
});

describe("choice", () => {
  const field = s.choice({
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    default: "a",
  });

  test("accepts a listed option and rejects anything else", () => {
    assert.equal(value(field.parse("b")), "b");
    assert.equal(field.parse("c").ok, false);
  });

  test("falls back to its default", () => {
    assert.equal(value(field.parse(undefined)), "a");
  });

  test("passes an option's description and recommended flag through to the dashboard", () => {
    const described = s
      .choice({
        options: [
          { value: "a", label: "A", description: "The first", recommended: true },
          { value: "b", label: "B" },
        ],
      })
      .describe();
    assert.deepEqual(JSON.parse(JSON.stringify(described.options)), [
      { value: "a", label: "A", description: "The first", recommended: true },
      { value: "b", label: "B" },
    ]);
  });
});

describe("array", () => {
  test("defaults to empty when absent", () => {
    assert.deepEqual(value(s.array(s.channel()).parse(undefined)), []);
  });

  test("reports the index of the offending entry", () => {
    const result = s.array(s.channel()).parse([CHANNEL, "bad"], "ignoreChannels");
    const [first] = errors(result);
    assert.equal(first?.path, "ignoreChannels[1]");
  });

  test("enforces min and max entries", () => {
    assert.equal(s.array(s.channel(), { min: 1 }).parse([]).ok, false);
    assert.equal(s.array(s.channel(), { max: 1 }).parse([CHANNEL, CHANNEL]).ok, false);
  });

  test("counts entries in the singular and the plural", () => {
    assert.equal(errors(s.array(s.channel(), { min: 1 }).parse([]))[0]?.message, "needs at least 1 entry");
    assert.equal(errors(s.array(s.channel(), { min: 2 }).parse([]))[0]?.message, "needs at least 2 entries");
    assert.equal(errors(s.array(s.channel(), { max: 1 }).parse([CHANNEL, CHANNEL]))[0]?.message, "allows at most 1 entry");
  });

  test("names what one entry is for the dashboard", () => {
    assert.equal(s.array(s.object({}), { item: "game" }).describe().item, "game");
  });

  test("rejects a non-array", () => {
    assert.equal(s.array(s.channel()).parse("nope").ok, false);
  });

  test("allows a repeated entry unless it is unique", () => {
    assert.deepEqual(value(s.array(s.channel()).parse([CHANNEL, CHANNEL])), [CHANNEL, CHANNEL]);
  });

  test("a unique list refuses the same value twice and points at the second", () => {
    const list = s.array(s.channel(), { unique: true });
    assert.deepEqual(value(list.parse([CHANNEL, "223456789012345678"])), [CHANNEL, "223456789012345678"]);
    const [first] = errors(list.parse([CHANNEL, "223456789012345678", CHANNEL], "ignore"));
    assert.equal(first?.path, "ignore[2]");
  });

  test("falls back to its declared default when absent, and gives each read its own copy", () => {
    const list = s.array(s.channel(), { default: [CHANNEL] });
    const first = value(list.parse(undefined));
    assert.deepEqual(first, [CHANNEL]);
    first.push("x");
    assert.deepEqual(value(list.parse(undefined)), [CHANNEL]);
  });

  test("a stored empty list is not replaced by the default", () => {
    assert.deepEqual(value(s.array(s.channel(), { default: [CHANNEL] }).parse([])), []);
  });

  describe("as a multi-select", () => {
    const picks = s.array(
      s.choice({
        options: [
          { value: "a", label: "A", recommended: true },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ],
      }),
      { min: 1, unique: true, default: ["a"] },
    );

    test("takes any combination of the options", () => {
      assert.deepEqual(value(picks.parse(["c", "a"])), ["c", "a"]);
    });

    test("refuses an empty list, a repeat and an unknown option", () => {
      assert.equal(picks.parse([]).ok, false);
      assert.equal(picks.parse(["a", "a"]).ok, false);
      assert.equal(picks.parse(["a", "z"]).ok, false);
    });

    test("describes itself with the item options, the limits, unique and the default", () => {
      const described = JSON.parse(JSON.stringify(picks.describe()));
      assert.equal(described.kind, "array");
      assert.equal(described.min, 1);
      assert.equal(described.unique, true);
      assert.deepEqual(described.default, ["a"]);
      assert.equal(described.of.kind, "choice");
      assert.deepEqual(described.of.options, [
        { value: "a", label: "A", recommended: true },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
      ]);
    });
  });

  test("describes as before when neither unique nor a default is set", () => {
    const described = s.array(s.channel()).describe();
    assert.equal("unique" in described, false);
    assert.equal("default" in described, false);
  });
});

describe("object", () => {
  const shape = s.object({
    accent: s.choice({ options: [{ value: "blurple", label: "Blurple" }], default: "blurple" }),
    channel: s.channel(),
    verbose: s.boolean({ default: true }),
  });

  test("fills defaults for keys absent from storage", () => {
    const parsed = value(shape.parse({ channel: CHANNEL }));
    assert.equal(parsed.accent, "blurple");
    assert.equal(parsed.verbose, true);
  });

  test("reports a dotted path for a nested failure", () => {
    const [first] = errors(shape.parse({ channel: "bad" }));
    assert.equal(first?.path, "channel");
  });

  test("collects every failure, not just the first", () => {
    const nested = s.object({ a: s.channel(), b: s.channel() });
    assert.equal(errors(nested.parse({})).length, 2);
  });

  test("treats absent input as an empty object so defaults still apply", () => {
    assert.equal(errors(shape.parse(undefined)).length, 1);
  });

  test("drops keys the schema does not declare", () => {
    const parsed = value(shape.parse({ channel: CHANNEL, stale: "x" }));
    assert.equal("stale" in (parsed as Record<string, unknown>), false);
  });
});

describe("describe() for the dashboard", () => {
  test("exposes nested field descriptors", () => {
    const described = s.object({ list: s.array(s.role()) }).describe();
    const fields = described.fields as Record<string, { kind: string; of?: { kind: string } }>;
    assert.equal(fields.list?.kind, "array");
    assert.equal(fields.list?.of?.kind, "role");
  });

  test("carries labels and help text", () => {
    const described = s.string({ label: "Name", help: "Shown in the embed" }).describe();
    assert.equal(described.label, "Name");
    assert.equal(described.help, "Shown in the embed");
  });
});

describe("essential", () => {
  test("reaches the dashboard from every kind of field", () => {
    assert.equal(s.channel({ essential: true }).describe().essential, true);
    assert.equal(s.role({ essential: true }).describe().essential, true);
    assert.equal(s.string({ essential: true }).describe().essential, true);
    assert.equal(s.duration({ essential: true }).describe().essential, true);
    assert.equal(s.array(s.role(), { essential: true }).describe().essential, true);
    assert.equal(s.object({}, { essential: true }).describe().essential, true);
  });

  test("is absent from a field that does not declare it", () => {
    assert.equal("essential" in s.channel().describe(), false);
  });

  test("survives nesting, so a group's children keep their own flags", () => {
    const described = s.object({
      panel: s.object({ channel: s.channel({ essential: true }) }),
    }).describe();
    const fields = described.fields as Record<string, { fields: Record<string, { essential?: boolean }> }>;
    assert.equal(fields.panel?.fields.channel?.essential, true);
  });

  test("does not make an optional field required", () => {
    const field = s.object({ channel: s.channel({ optional: true, essential: true }) });
    assert.equal(field.parse({}).ok, true);
  });
});

describe("when", () => {
  test("carries the sibling and the value it must equal", () => {
    const described = s.duration({ when: { field: "action", equals: "timeout" } }).describe();
    assert.deepEqual(described.when, { field: "action", equals: "timeout" });
  });

  test("may name a sibling without naming a value", () => {
    const described = s.template({ when: { field: "channel" } }).describe();
    assert.deepEqual(described.when, { field: "channel" });
  });

  test("is absent from a field that does not declare it", () => {
    assert.equal("when" in s.template().describe(), false);
  });

  test("carries the value a sibling list must contain", () => {
    const described = s.duration({ when: { field: "actions", includes: "timeout" } }).describe();
    assert.deepEqual(described.when, { field: "actions", includes: "timeout" });
  });

  test("does not change what parses", () => {
    const field = s.object({
      enabled: s.boolean({ default: false }),
      after: s.duration({ default: "24h", when: { field: "enabled", equals: true } }),
    });
    const parsed = value(field.parse({}));
    assert.equal((parsed as Record<string, unknown>).after, 86_400_000);
  });
});

describe("optional", () => {
  test("an absent optional field is simply omitted", () => {
    const parsed = value(s.object({ note: s.string({ optional: true }) }).parse({}));
    assert.equal("note" in (parsed as Record<string, unknown>), false);
  });

  test("a field declared optional with a default still receives its default", () => {
    const parsed = value(
      s.object({ note: s.string({ optional: true, default: "fallback" }) }).parse({}),
    );
    assert.equal((parsed as Record<string, unknown>).note, "fallback");
  });
});

describe("string with url", () => {
  const field = s.string({ url: true });

  test("accepts a whole http or https address, trimmed", () => {
    assert.equal(value(field.parse(" https://retro-corner.example/feed.xml ")), "https://retro-corner.example/feed.xml");
    assert.equal(value(field.parse("http://localhost:8080/rss")), "http://localhost:8080/rss");
  });

  test("refuses anything that is not one", () => {
    assert.equal(field.parse("retro-corner.example/feed").ok, false);
    assert.equal(field.parse("ftp://example.com/feed").ok, false);
    assert.equal(field.parse("https://exa mple.com").ok, false);
    assert.equal(errors(field.parse("nope"))[0]?.message, "must be a web address starting with http:// or https://");
  });

  test("says so in its description for the dashboard", () => {
    assert.equal(field.describe().url, true);
  });
});

describe("emoji", () => {
  test("accepts a unicode emoji", () => {
    assert.equal(value(s.emoji().parse("🎉")), "🎉");
    assert.equal(value(s.emoji().parse("✅")), "✅");
  });

  test("accepts Discord's custom form, animated or not", () => {
    assert.equal(value(s.emoji().parse("<:party:123456789012345678>")), "<:party:123456789012345678>");
    assert.equal(s.emoji().parse("<a:spin:123456789012345678>").ok, true);
  });

  test("rejects text typed into the wrong box", () => {
    assert.equal(s.emoji().parse("party").ok, false);
    assert.equal(s.emoji().parse("this is a sentence").ok, false);
    assert.equal(s.emoji().parse("<:bad:notanid>").ok, false);
  });

  test("trims surrounding whitespace", () => {
    assert.equal(value(s.emoji().parse(" 🎉 ")), "🎉");
  });

  test("accepts an emoji joined from several code points", () => {
    assert.equal(s.emoji().parse("👨‍👩‍👧‍👦").ok, true);
    assert.equal(s.emoji().parse("🏳️‍🌈").ok, true);
    assert.equal(s.emoji().parse("1️⃣").ok, true);
    assert.equal(s.emoji().parse("🇬🇧").ok, true);
  });

  test("refuses two emoji in one box", () => {
    assert.equal(s.emoji().parse("🎉🎉🎉🎉🎉").ok, false);
  });

  test("says what it accepts in words that match the dashboard hint", () => {
    const [problem] = errors(s.emoji().parse("smile"));
    assert.equal(problem?.message, "must be one emoji, or a custom emoji from this server written as <:name:id>");
  });
});

describe("template", () => {
  const field = s.template({ placeholders: ["user", "server"] });

  test("accepts placeholders the module declares", () => {
    assert.equal(value(field.parse("Welcome {user} to {server}")), "Welcome {user} to {server}");
  });

  test("names the first placeholder it does not recognize", () => {
    const result = field.parse("Hello {nobody}");
    assert.equal(result.ok, false);
    assert.match(String(errors(result)[0]?.message), /\{nobody\}/);
  });

  test("accepts text with no placeholders at all", () => {
    assert.equal(value(field.parse("Welcome!")), "Welcome!");
  });

  test("caps length at Discord's message limit by default", () => {
    assert.equal(field.parse("x".repeat(2001)).ok, false);
    assert.equal(field.parse("x".repeat(2000)).ok, true);
  });

  test("publishes its placeholders to the dashboard", () => {
    assert.deepEqual(field.describe().placeholders, ["user", "server"]);
  });
});

describe("message", () => {
  const starting = { content: "{user} reached level {level}!", embeds: [], buttons: [], selects: [], reactions: [] };
  const field = s.message({
    label: "Level-up message",
    starting,
    variables: [{ name: "user", description: "The member", sample: "Ada" }],
  });

  test("reads a stored message", () => {
    const stored = { ...starting, content: "Well done {user}", reactions: ["🎉"] };
    const read = value(field.parse(stored));
    assert.equal(read.content, "Well done {user}");
    assert.deepEqual(read.reactions, ["🎉"]);
  });

  test("reads a plain string saved while the setting was a template", () => {
    const read = value(field.parse("Hello {user}"));
    assert.equal(read.content, "Hello {user}");
    assert.deepEqual(read.embeds, []);
  });

  test("falls back to what the feature sends today when nothing is stored", () => {
    assert.deepEqual(value(field.parse(undefined)), starting);
    assert.deepEqual(value(field.parse("   ")), starting);
    assert.deepEqual(field.defaultValue, starting);
  });

  test("rejects a message Discord would refuse", () => {
    assert.equal(field.parse({ content: "", embeds: [] }).ok, false);
    assert.equal(field.parse({ content: "x".repeat(2001) }).ok, false);
    assert.equal(field.parse("x".repeat(2001)).ok, false);
    assert.equal(field.parse(42).ok, false);
    const reported = errors(field.parse({ content: "" }, "announce.message"));
    assert.equal(reported[0]?.path, "announce.message");
  });

  test("describes itself as plain JSON for the dashboard", () => {
    const withNote = s.message({ starting, delivery: "dm", components: false, note: "Sent once." });
    const described = JSON.parse(JSON.stringify(withNote.describe())) as Record<string, unknown>;
    assert.equal(described.kind, "message");
    assert.equal(described.delivery, "dm");
    assert.equal(described.components, false);
    assert.equal(described.note, "Sent once.");
    assert.deepEqual(described.starting, starting);
    assert.deepEqual(described.default, starting);
    assert.deepEqual(field.describe().variables, [{ name: "user", description: "The member", sample: "Ada" }]);
    assert.equal(field.describe().delivery, "channel");
    assert.equal(field.describe().components, true);
  });

  test("drops what a direct message cannot carry", () => {
    const dm = s.message({ starting, delivery: "dm" });
    const read = value(
      dm.parse({
        content: "Hi",
        reactions: ["🎉"],
        buttons: [
          { label: "Docs", style: "link", url: "https://example.com" },
          { label: "Press", style: "primary" },
        ],
        selects: [
          { kind: "user", placeholder: "Pick" },
          { kind: "string", placeholder: "Choose", options: [{ label: "A", value: "a" }] },
        ],
      }),
    );
    assert.deepEqual(read.reactions, []);
    assert.deepEqual(read.selects.map((select) => select.kind), ["string"]);
    assert.equal(read.buttons.length, 2);
  });

  test("drops every button and menu where components are turned off", () => {
    const bare = s.message({ starting, components: false });
    const read = value(bare.parse({ content: "Hi", buttons: [{ label: "Docs", style: "link", url: "https://example.com" }], reactions: ["🎉"] }));
    assert.deepEqual(read.buttons, []);
    assert.deepEqual(read.reactions, ["🎉"]);
  });
});

describe("object upgrade", () => {
  const field = s.object(
    { text: s.string({ optional: true }), loud: s.boolean({ default: false }) },
    {
      upgrade: (stored) => (typeof stored.message === "string" ? { ...stored, text: stored.message } : stored),
    },
  );

  test("reads a value saved under the old shape", () => {
    const result = field.parse({ message: "hello" });
    assert.deepEqual(result.ok && result.value, { text: "hello", loud: false });
  });

  test("leaves a current value alone", () => {
    const result = field.parse({ text: "hi", loud: true });
    assert.deepEqual(result.ok && result.value, { text: "hi", loud: true });
  });

  test("does not put the hook in what the dashboard receives", () => {
    assert.equal("upgrade" in field.describe(), false);
  });
});

describe("dashboard layout metadata", () => {
  test("a group passes its collapsible flag and summary keys through", () => {
    const field = s.object(
      { enabled: s.boolean({ default: false }), actions: s.array(s.string()) },
      { label: "Rule", collapsible: true, summary: ["actions"] },
    );
    const described = field.describe();
    assert.equal(described.collapsible, true);
    assert.deepEqual(described.summary, ["actions"]);
  });

  test("a group that does not ask for it carries neither", () => {
    const described = s.object({ on: s.boolean() }).describe();
    assert.equal("collapsible" in described, false);
    assert.equal("summary" in described, false);
  });

  test("the flags do not change what a group accepts", () => {
    const field = s.object({ on: s.boolean({ default: true }) }, { collapsible: true, summary: ["on"] });
    const result = field.parse({});
    assert.deepEqual(result.ok && result.value, { on: true });
  });

  test("a message passes its compact flag through", () => {
    const starting = { content: "Hi", embeds: [], buttons: [], selects: [], reactions: [] };
    assert.equal(s.message({ starting, compact: true }).describe().compact, true);
    assert.equal(s.message({ starting }).describe().compact, undefined);
  });

  test("a list of choices passes its layout through", () => {
    const options = [{ value: "a", label: "A" }];
    assert.equal(s.array(s.choice({ options }), { layout: "rows" }).describe().layout, "rows");
    assert.equal(s.array(s.choice({ options })).describe().layout, undefined);
  });
});

describe("a generated id", () => {
  const id = s.string({ generated: true });

  test("is described as generated, so the dashboard draws nothing for it", () => {
    assert.equal(id.describe().generated, true);
    assert.equal(s.string().describe().generated, undefined);
  });

  test("may be missing, for old rows an upgrade fills in", () => {
    assert.equal(value(id.parse(undefined)), undefined);
    assert.equal(value(id.parse("")), undefined);
  });

  test("must be short and safe in a custom id", () => {
    assert.equal(value(id.parse("a1b2-c3_d")), "a1b2-c3_d");
    assert.equal(id.parse("has space").ok, false);
    assert.equal(id.parse("x:y").ok, false);
    assert.equal(id.parse("x".repeat(33)).ok, false);
  });

  test("is made eight characters long", () => {
    const made = generatedId();
    assert.equal(made.length, 8);
    assert.match(made, GENERATED_ID);
    assert.notEqual(generatedId(), made);
  });
});

describe("section", () => {
  test("is carried to the dashboard and changes nothing about parsing", () => {
    const group = s.object({ on: s.boolean({ default: true }) }, { label: "Group", section: "general" });
    assert.equal(group.describe().section, "general");
    assert.equal(s.array(s.role(), { section: "panels" }).describe().section, "panels");
    assert.deepEqual(value(group.parse({})), { on: true });
  });
});

describe("messageAttachProblems", () => {
  const row = s.object({ name: s.string(), emoji: s.emoji({ optional: true }), look: s.object({ text: s.string({ optional: true }), colour: s.choice({ options: [{ value: "primary", label: "Blurple" }], default: "primary" }) }) });
  const parent = s.object({ items: s.array(row), mode: s.choice({ options: [{ value: "menu", label: "Menu" }], default: "menu" }), hint: s.string({ optional: true }), on: s.boolean() }).describe().fields as Record<string, FieldDescriptor>;
  const root = s.object({ labels: s.object({ close: s.string(), closeColour: s.choice({ options: [{ value: "danger", label: "Red" }], default: "danger" }) }) }).describe().fields as Record<string, FieldDescriptor>;

  test("accepts paths that name settings of the right kind", () => {
    assert.deepEqual(
      messageAttachProblems(
        { kind: "list", list: "items", label: "look.text", labelFallback: "name", emoji: "emoji", style: "look.colour", mode: { field: "mode", menu: "menu" }, placeholder: "hint", noun: "item" },
        parent,
        root,
      ),
      [],
    );
    assert.deepEqual(
      messageAttachProblems({ kind: "buttons", buttons: [{ name: "Close", label: "/labels.close", style: "/labels.closeColour", when: "on" }] }, parent, root),
      [],
    );
  });

  test("names every path that does not exist or is the wrong kind", () => {
    const problems = messageAttachProblems(
      { kind: "buttons", buttons: [{ name: "Close", label: "/labels.missing", style: "/labels.close", when: "nope" }] },
      parent,
      root,
    );
    assert.equal(problems.length, 3);
    assert.match(problems.join(" | "), /labels\.missing.*not a setting/);
    assert.match(problems.join(" | "), /string rather than a choice/);
    assert.equal(messageAttachProblems({ kind: "list", list: "mode", label: "x", noun: "x" }, parent, root).length, 1);
  });
});

describe("layout metadata", () => {
  const reply = (topic?: string) =>
    s.message({ label: "Reply", starting: plainReply("Hi"), ...(topic ? { topic } : {}) });

  test("is carried by describe on groups, settings and messages", () => {
    const group = s.object(
      { claimed: s.message({ label: "Claimed", starting: plainReply("Claimed"), topic: "open", audience: "public" }) },
      { label: "What the bot says", layout: "messages", topics: [{ id: "open", label: "While a ticket is open" }] },
    ).describe();
    assert.equal(group.layout, "messages");
    assert.deepEqual(group.topics, [{ id: "open", label: "While a ticket is open" }]);
    const claimed = (group.fields as Record<string, FieldDescriptor>).claimed;
    assert.equal(claimed?.topic, "open");
    assert.equal(claimed?.audience, "public");
    assert.equal(s.string({ topic: "buttons" }).describe().topic, "buttons");
  });

  const schema = (fields: Parameters<typeof s.object>[0]) => s.object(fields).describe();

  test("finds nothing wrong with headings that exist and nest once", () => {
    const problems = layoutProblems(
      schema({
        messages: s.object(
          { a: reply("open"), wrong: s.object({ b: reply() }, { topic: "denied" }) },
          {
            layout: "messages",
            topics: [
              { id: "open", label: "Open" },
              { id: "wrong", label: "Wrong" },
              { id: "denied", label: "Denied", within: "wrong" },
            ],
          },
        ),
        ratings: s.object({ thanks: reply("open") }),
      }),
    );
    assert.deepEqual(problems, []);
  });

  test("names a topic no group declares, a heading nested twice and a layout below the top", () => {
    const problems = layoutProblems(
      schema({
        messages: s.object(
          { a: reply("closed"), inner: s.object({ b: reply() }, { layout: "fields", topics: [{ id: "x", label: "X" }] }) },
          {
            layout: "messages",
            topics: [
              { id: "a", label: "A" },
              { id: "b", label: "B", within: "a" },
              { id: "c", label: "C", within: "b" },
            ],
          },
        ),
        other: s.object({ c: reply("nowhere") }),
      }),
    ).join(" | ");
    assert.match(problems, /messages\.a names the topic closed/);
    assert.match(problems, /topic c is within b, which is itself within another/);
    assert.match(problems, /messages\.inner has a layout but is not a top-level group/);
    assert.match(problems, /other\.c names the topic nowhere, which no messages list declares/);
  });

  test("keeps settings that are not messages out of a messages list, and messages out of a fields list", () => {
    const problems = layoutProblems(
      s.object({
        messages: s.object({ count: s.integer({ topic: "a" }) }, { layout: "messages", topics: [{ id: "a", label: "A" }] }),
        labels: s.object({ msg: reply("b") }, { layout: "fields", topics: [{ id: "b", label: "B" }] }),
        loose: s.object({ name: s.string({ topic: "a" }) }),
      }).describe(),
    ).join(" | ");
    assert.match(problems, /messages.count is not a message/);
    assert.match(problems, /labels\.msg is a message in a fields list/);
    assert.match(problems, /loose\.name names a topic but is neither in a layout group nor a message/);
  });
});

describe("form metadata for rows", () => {
  const colours = [
    { value: "red", label: "Red", swatch: "#f00" },
    { value: "blue", label: "Blue", swatch: "#00f" },
  ];
  const row = (extra: Record<string, ReturnType<typeof s.string>> = {}) =>
    s.object(
      {
        name: s.string({ label: "Name", section: "basics" }),
        colour: s.choice({ options: colours, control: "swatches", section: "basics" }),
        roles: s.array(s.role(), { nudge: "No roles yet", section: "people" }),
        ...extra,
      },
      {},
    );
  const schema = (list: ReturnType<typeof s.array>) => s.object({ items: list }).describe();

  test("passes a sheet, its card, a nudge, a control and a swatch through to the dashboard", () => {
    const list = s.array(row(), { layout: "sheet", card: { swatch: "colour", chips: "roles" }, item: "thing" }).describe();
    assert.equal(list.layout, "sheet");
    assert.deepEqual(list.card, { swatch: "colour", chips: "roles" });
    const fields = (list.of as { fields: Record<string, Record<string, unknown>> }).fields;
    assert.equal(fields.roles?.nudge, "No roles yet");
    assert.equal(fields.colour?.control, "swatches");
    assert.equal((fields.colour?.options as { swatch: string }[])[0]?.swatch, "#f00");
  });

  test("a hidden condition and a list of steps are passed through and change nothing stored", () => {
    const group = s.object(
      {
        mode: s.choice({ options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a", step: "one" }),
        extra: s.string({ optional: true, when: { field: "mode", equals: "b", hide: true }, step: "two" }),
      },
      { steps: [{ id: "one", title: "One" }, { id: "two", title: "Two", help: "Second." }] },
    );
    const described = group.describe();
    assert.equal((described.steps as { id: string }[]).length, 2);
    assert.equal(((described.fields as Record<string, { when: { hide: boolean } }>).extra as { when: { hide: boolean } }).when.hide, true);
    const parsed = group.parse({ mode: "a", extra: "kept" });
    assert.deepEqual(parsed.ok && parsed.value, { mode: "a", extra: "kept" });
  });

  test("finds nothing wrong with a sheet that reads its own settings", () => {
    const list = s.array(row(), { layout: "sheet", card: { emoji: undefined, swatch: "colour", chips: "roles" } });
    assert.deepEqual(formLayoutProblems(schema(list)), []);
  });

  test("refuses a sheet that is not a list of rows, and a card on a plain list", () => {
    assert.equal(formLayoutProblems(schema(s.array(s.string(), { layout: "sheet" }))).length, 1);
    const plain = s.object({ name: s.string(), roles: s.array(s.role()) });
    assert.equal(formLayoutProblems(schema(s.array(plain, { card: { chips: "roles" } }))).length, 1);
  });

  test("refuses a card that names a setting the row does not have, or one of the wrong kind", () => {
    const missing = formLayoutProblems(schema(s.array(row(), { layout: "sheet", card: { chips: "nobody" } })));
    assert.match(missing.join(), /nobody/);
    const wrong = formLayoutProblems(schema(s.array(row(), { layout: "sheet", card: { swatch: "name" } })));
    assert.match(wrong.join(), /string/);
  });

  test("refuses a section outside a top-level setting or a sheet row", () => {
    const plain = s.object({ group: s.object({ inner: s.string({ section: "x" }) }) }).describe();
    assert.equal(formLayoutProblems(plain).length, 1);
    const inSheet = schema(s.array(row(), { layout: "sheet" }));
    assert.deepEqual(formLayoutProblems(inSheet), []);
  });

  test("refuses a step the group did not declare, and steps with nothing in them", () => {
    const wrap = (group: ReturnType<typeof s.object>) => s.object({ group }).describe();
    assert.equal(formLayoutProblems(wrap(s.object({ a: s.string({ step: "one" }) }))).length, 1);
    const unknown = s.object({ a: s.string({ step: "nine" }) }, { steps: [{ id: "one", title: "One" }] });
    assert.match(formLayoutProblems(wrap(unknown)).join(), /nine/);
    const twice = s.object({ a: s.string() }, { steps: [{ id: "one", title: "One" }, { id: "one", title: "Again" }] });
    assert.match(formLayoutProblems(wrap(twice)).join(), /twice/);
  });

  test("refuses tab headings for tabs nothing is in, a segmented control of one option and swatches without colours", () => {
    const labelled = schema(
      s.array(
        s.object(
          { group: s.object({ a: s.string({ section: "basics" }) }, { tabLabels: { basics: "Here", rules: "There" } }), name: s.string({ section: "basics" }) },
          {},
        ),
        { layout: "sheet" },
      ),
    );
    assert.match(formLayoutProblems(labelled).join(), /rules/);
    const one = s.object({ c: s.choice({ options: [{ value: "a", label: "A" }], control: "segmented" }) }).describe();
    assert.equal(formLayoutProblems(one).length, 1);
    const bare = s.object({ c: s.choice({ options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], control: "swatches" }) }).describe();
    assert.equal(formLayoutProblems(bare).length, 1);
  });
});

describe("a list drawn as a form preview", () => {
  const question = s.object({
    label: s.string({ label: "Question" }),
    placeholder: s.string({ optional: true }),
    style: s.choice({ options: [{ value: "short", label: "One line" }, { value: "paragraph", label: "Several lines" }], default: "short" }),
    required: s.boolean({ default: true }),
  });
  const group = (preview: Record<string, string>) =>
    s.object({
      group: s.object({
        name: s.string({ label: "Name" }),
        form: s.array(question, { formPreview: { kind: "modal", ...preview } as never }),
      }),
    }).describe();

  test("is passed through to the dashboard", () => {
    const described = s.array(question, { formPreview: { kind: "modal", label: "label" } }).describe();
    assert.deepEqual(described.formPreview, { kind: "modal", label: "label" });
  });

  test("finds nothing wrong when every path names a setting of the right kind", () => {
    assert.deepEqual(formLayoutProblems(group({ title: "name", label: "label", placeholder: "placeholder", style: "style", required: "required" })), []);
  });

  test("refuses a path that names nothing, or the wrong kind of setting, and a title that is not beside the list", () => {
    assert.match(formLayoutProblems(group({ label: "nothing" })).join(), /nothing/);
    assert.match(formLayoutProblems(group({ label: "label", style: "label" })).join(), /style/);
    assert.match(formLayoutProblems(group({ label: "label", title: "form" })).join(), /title/);
  });

  test("refuses a form preview on a list that is not of rows", () => {
    const plain = s.object({ list: s.array(s.string(), { formPreview: { kind: "modal", label: "label" } }) }).describe();
    assert.equal(formLayoutProblems(plain).length, 1);
  });
});
