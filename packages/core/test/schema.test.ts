import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { s } from "../dist/index.js";

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

  test("rejects a non-array", () => {
    assert.equal(s.array(s.channel()).parse("nope").ok, false);
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
