import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_LIMITS,
  applyVariables,
  applyVariablesToMessage,
  cleanName,
  colorToInt,
  discordTimestamp,
  emptyEmbed,
  isEmojiToken,
  linksOnly,
  parseMessage,
  flattenEmbeds,
  parseSendOptions,
  restrictMessage,
} from "../dist/message.js";
import { embedReply, REPLY_COLOR } from "../dist/response.js";

const embed = (patch: Record<string, unknown> = {}) => ({ ...emptyEmbed(), title: "Rules", ...patch });

describe("parseMessage", () => {
  test("accepts plain text", () => {
    const result = parseMessage({ content: "Welcome" });
    assert.equal(result.ok, true);
  });

  test("accepts an embed with no text", () => {
    assert.equal(parseMessage({ content: "", embeds: [embed()] }).ok, true);
  });

  test("refuses a message with nothing in it", () => {
    const result = parseMessage({ content: "   ", embeds: [] });
    assert.equal(result.ok, false);
  });

  test("fills a missing embed field with its empty value", () => {
    const result = parseMessage({ embeds: [{ title: "Only a title" }] });
    assert.ok(result.ok);
    assert.equal(result.value.embeds[0]?.fields.length, 0);
    assert.equal(result.value.embeds[0]?.color, "");
  });

  test("counts over-long text against Discord's limits", () => {
    const result = parseMessage({ content: "x".repeat(MESSAGE_LIMITS.content + 1) });
    assert.ok(!result.ok);
    assert.equal(result.errors[0]?.path, "content");
  });

  test("names the field a problem is in", () => {
    const result = parseMessage({ embeds: [embed({ fields: [{ name: "Ok", value: "" }] })] });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.path === "embeds[0].fields[0].value"));
  });

  test("refuses a link that is not http or https", () => {
    const result = parseMessage({ embeds: [embed({ url: "javascript:alert(1)", imageUrl: "ftp://x/y.png" })] });
    assert.ok(!result.ok);
    const paths = result.errors.map((e) => e.path);
    assert.ok(paths.includes("embeds[0].url"));
    assert.ok(paths.includes("embeds[0].imageUrl"));
  });

  test("refuses a colour that is not six hex digits", () => {
    assert.ok(!parseMessage({ embeds: [embed({ color: "red" })] }).ok);
    assert.ok(parseMessage({ embeds: [embed({ color: "#E3B34A" })] }).ok);
  });

  test("refuses an embed that would show nothing", () => {
    const result = parseMessage({ content: "hi", embeds: [emptyEmbed()] });
    assert.ok(!result.ok);
  });

  test("limits embeds, fields and the combined length", () => {
    assert.ok(!parseMessage({ embeds: Array.from({ length: 11 }, () => embed()) }).ok);
    const fields = Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: "v" }));
    assert.ok(!parseMessage({ embeds: [embed({ fields })] }).ok);
    const big = { description: "x".repeat(4000) };
    assert.ok(!parseMessage({ embeds: [embed(big), embed(big)] }).ok);
  });

  test("ignores anything that is not an object", () => {
    assert.ok(!parseMessage("hello").ok);
    assert.ok(!parseMessage(null).ok);
  });
});

describe("colorToInt", () => {
  test("reads a hex colour", () => {
    assert.equal(colorToInt("#e3b34a"), 0xe3b34a);
    assert.equal(colorToInt(""), undefined);
  });
});

describe("cleanName", () => {
  test("trims and collapses spaces", () => {
    assert.deepEqual(cleanName("  Rules   v2 ", 80, "The name"), { ok: true, value: "Rules v2" });
  });

  test("refuses an empty or over-long name", () => {
    assert.equal(cleanName("   ", 80, "The name").ok, false);
    assert.equal(cleanName("x".repeat(81), 80, "The name").ok, false);
  });
});

describe("timestamps on an embed", () => {
  test("reads the old true as the time it is sent", () => {
    const result = parseMessage({ embeds: [embed({ timestamp: true })] });
    assert.ok(result.ok);
    assert.equal(result.value.embeds[0]?.timestamp, "now");
  });

  test("accepts a chosen date and refuses nonsense", () => {
    assert.ok(parseMessage({ embeds: [embed({ timestamp: "2026-12-25T09:00:00.000Z" })] }).ok);
    assert.ok(!parseMessage({ embeds: [embed({ timestamp: "next tuesday" })] }).ok);
  });
});

describe("buttons and reactions", () => {
  test("a link button needs a label or emoji and a web address", () => {
    assert.ok(parseMessage({ content: "x", buttons: [{ label: "Rules", url: "https://example.com" }] }).ok);
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "", url: "https://example.com" }] }).ok);
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "Go", style: "link", url: "" }] }).ok);
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "Go", url: "javascript:1" }] }).ok);
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "Go", style: "link", url: "javascript:1" }] }).ok);
  });

  test("allows twenty-five buttons and no more", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `b${i}`, url: "https://example.com" }));
    assert.ok(parseMessage({ content: "x", buttons: many(25) }).ok);
    assert.ok(!parseMessage({ content: "x", buttons: many(26) }).ok);
  });

  test("keeps real emoji and refuses words", () => {
    assert.ok(parseMessage({ content: "x", reactions: ["👍", "<:party:123456789012345678>"] }).ok);
    assert.ok(!parseMessage({ content: "x", reactions: ["thumbsup"] }).ok);
  });

  test("drops repeated reactions", () => {
    const result = parseMessage({ content: "x", reactions: ["👍", "👍"] });
    assert.ok(result.ok);
    assert.deepEqual(result.value.reactions, ["👍"]);
  });
});

describe("isEmojiToken", () => {
  test("accepts the shapes Discord uses", () => {
    for (const ok of ["😀", "👍🏽", "❤️", "1️⃣", "🇬🇧", "👨‍👩‍👧", "<a:wave:123456789012345678>"]) assert.ok(isEmojiToken(ok), ok);
    for (const bad of ["a", "", "ab", ":smile:", "<:x:1>"]) assert.ok(!isEmojiToken(bad), bad);
  });
});

describe("variables", () => {
  const values = { server: "Northwind", members: "2,431", "channel.name": "rules" };

  test("fills known names and leaves anything else as typed", () => {
    assert.equal(applyVariables("Welcome to {server}! {oops} {members}", values), "Welcome to Northwind! {oops} 2,431");
    assert.equal(applyVariables("in #{channel.name}", values), "in #rules");
  });

  test("names may use capital letters and digits, as a module's own variables do", () => {
    assert.equal(applyVariables("{memberCount} and {tier2}", { memberCount: "128", tier2: "x" }), "128 and x");
  });

  test("reaches every piece of text and picture address and the title link and a link button's address but not what other buttons do", () => {
    const message = applyVariablesToMessage(
      {
        content: "{server}",
        embeds: [{ ...emptyEmbed(), title: "{server}", description: "{members}", url: "https://example.com/{server}", thumbnailUrl: "https://example.com/{server}.png", footerText: "{server}", fields: [{ name: "{server}", value: "{members}", inline: false }] }],
        buttons: [{ label: "{server}", url: "https://example.com/{server}", emoji: "", style: "link" as const, disabled: false, action: { type: "none" as const } }],
        selects: [],
        reactions: [],
      },
      values,
    );
    assert.equal(message.content, "Northwind");
    assert.equal(message.embeds[0]?.title, "Northwind");
    assert.equal(message.embeds[0]?.fields[0]?.value, "2,431");
    assert.equal(message.embeds[0]?.url, "https://example.com/Northwind");
    assert.equal(message.embeds[0]?.thumbnailUrl, "https://example.com/Northwind.png");
    assert.equal(message.buttons[0]?.label, "Northwind");
    assert.equal(message.buttons[0]?.url, "https://example.com/Northwind");
  });

  test("fills a title link and a time that are a variable on their own", () => {
    const embed = { ...emptyEmbed(), title: "T", url: "{link}", authorUrl: "{link}", timestamp: "{published.iso}" };
    const checked = parseMessage({ content: "", embeds: [embed] });
    assert.equal(checked.ok, true);
    const filled = applyVariablesToMessage(
      { content: "", embeds: [embed], buttons: [], selects: [], reactions: [] },
      { link: "https://example.com/a", "published.iso": "2026-01-01T00:00:00.000Z" },
    );
    assert.equal(filled.embeds[0]?.url, "https://example.com/a");
    assert.equal(filled.embeds[0]?.timestamp, "2026-01-01T00:00:00.000Z");
  });

  test("still rejects an address that is not a variable and not a web address", () => {
    assert.equal(parseMessage({ content: "", embeds: [{ title: "T", url: "nope" }] }).ok, false);
    assert.equal(parseMessage({ content: "", embeds: [{ title: "T", timestamp: "{a} b" }] }).ok, false);
  });
});

describe("an embed field that comes out empty", () => {
  const withFields = (fields: { name: string; value: string; inline: boolean }[]) => ({
    content: "",
    embeds: [{ ...emptyEmbed(), title: "Case", fields }],
    buttons: [],
    selects: [],
    reactions: [],
  });

  test("is left out when its variable is empty, so a line can exist only some of the time", () => {
    const body = withFields([
      { name: "Reason", value: "{reason}", inline: false },
      { name: "Expires", value: "{expires}", inline: false },
    ]);
    assert.equal(parseMessage(body).ok, true);
    const filled = applyVariablesToMessage(body, { reason: "Spam", expires: "" });
    assert.deepEqual(filled.embeds[0]?.fields.map((f) => f.name), ["Reason"]);
    assert.equal(parseMessage(filled).ok, true);
  });

  test("stays when it has a value", () => {
    const filled = applyVariablesToMessage(withFields([{ name: "Expires", value: "{expires}", inline: false }]), { expires: "soon" });
    assert.equal(filled.embeds[0]?.fields.length, 1);
  });
});

describe("a link button whose address is a variable", () => {
  const link = (url: string) => ({ label: "View in dashboard", emoji: "", style: "link" as const, url, disabled: false, action: { type: "none" as const } });
  const withButtons = (buttons: ReturnType<typeof link>[]) => ({ content: "Case", embeds: [], buttons, selects: [], reactions: [] });

  test("is accepted while it is being typed", () => {
    assert.equal(parseMessage(withButtons([link("{caseUrl}")])).ok, true);
    assert.equal(parseMessage(withButtons([link("{base}/cases/{case}")])).ok, true);
    assert.equal(parseMessage(withButtons([link("not a link")])).ok, false);
  });

  test("is filled in", () => {
    const filled = applyVariablesToMessage(withButtons([link("{caseUrl}")]), { caseUrl: "https://dash.example/guilds/1/mod/members/2?case=3" });
    assert.equal(filled.buttons[0]?.url, "https://dash.example/guilds/1/mod/members/2?case=3");
    assert.equal(parseMessage(filled).ok, true);
  });

  test("is dropped when it comes out empty, so the post goes without it", () => {
    const filled = applyVariablesToMessage(withButtons([link("{caseUrl}")]), { caseUrl: "" });
    assert.deepEqual(filled.buttons, []);
    assert.equal(parseMessage(filled).ok, true);
  });

  test("is dropped when it is not a web address once filled in, or when the variable is unknown", () => {
    assert.deepEqual(applyVariablesToMessage(withButtons([link("{caseUrl}")]), { caseUrl: "javascript:alert(1)" }).buttons, []);
    assert.deepEqual(applyVariablesToMessage(withButtons([link("{caseUrl}")]), {}).buttons, []);
  });

  test("leaves a static address and other buttons as they were", () => {
    const reply = { ...link(""), style: "primary" as const, label: "Reply" };
    const body = withButtons([link("https://example.com/rules"), reply]);
    const filled = applyVariablesToMessage(body, { caseUrl: "" });
    assert.deepEqual(filled.buttons, body.buttons);
  });
});

describe("discordTimestamp", () => {
  test("writes the unix time Discord expects", () => {
    assert.equal(discordTimestamp(new Date("2026-01-01T00:00:00Z"), "F"), "<t:1767225600:F>");
  });
});

describe("parseSendOptions", () => {
  const channelId = "123456789012345678";

  test("needs a real channel id", () => {
    assert.ok(!parseSendOptions({}).ok);
    assert.ok(parseSendOptions({ channelId }).ok);
  });

  test("everything is off unless it is turned on", () => {
    const result = parseSendOptions({ channelId });
    assert.ok(result.ok);
    assert.equal(result.value.allowEveryone, false);
    assert.equal(result.value.pin, false);
    assert.equal(result.value.silent, false);
  });

  test("takes a message link or an id for a reply", () => {
    const link = parseSendOptions({ channelId, replyTo: "https://discord.com/channels/1/2/987654321098765432" });
    assert.ok(link.ok);
    assert.equal(link.value.replyTo, "987654321098765432");
    assert.ok(!parseSendOptions({ channelId, replyTo: "latest" }).ok);
  });

  test("limits a thread name", () => {
    assert.ok(!parseSendOptions({ channelId, threadName: "x".repeat(101) }).ok);
  });
});

describe("button styles and actions", () => {
  test("a button saved with only an address is a link", () => {
    const result = parseMessage({ content: "x", buttons: [{ label: "Go", url: "https://example.com" }] });
    assert.ok(result.ok);
    assert.equal(result.value.buttons[0]?.style, "link");
  });

  test("a coloured button takes an action and no address", () => {
    const result = parseMessage({ content: "x", buttons: [{ label: "Hi", style: "success", url: "https://example.com", action: { type: "reply", reply: { content: "Hello {user}" } } }] });
    assert.ok(result.ok);
    const button = result.value.buttons[0];
    assert.equal(button?.url, "");
    assert.equal(button?.action.type, "reply");
    assert.equal(button?.action.type === "reply" && button.action.reply.ephemeral, true);
  });

  test("a role action needs a real role", () => {
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "Join", style: "primary", action: { type: "role", mode: "toggle", roleId: "nope" } }] }).ok);
    assert.ok(parseMessage({ content: "x", buttons: [{ label: "Join", style: "primary", action: { type: "role", mode: "add", roleId: "123456789012345678" } }] }).ok);
  });

  test("a reply that says nothing is refused", () => {
    assert.ok(!parseMessage({ content: "x", buttons: [{ label: "Hi", style: "primary", action: { type: "reply", reply: { content: " " } } }] }).ok);
  });

  test("a disabled button is kept disabled", () => {
    const result = parseMessage({ content: "x", buttons: [{ label: "Hi", style: "secondary", disabled: true }] });
    assert.ok(result.ok);
    assert.equal(result.value.buttons[0]?.disabled, true);
  });
});

describe("select menus", () => {
  const menu = (patch: Record<string, unknown> = {}) => ({
    kind: "string",
    placeholder: "Pick one",
    options: [
      { label: "Red", value: "red" },
      { label: "Blue", value: "blue" },
    ],
    ...patch,
  });

  test("accepts a menu of your own choices", () => {
    assert.ok(parseMessage({ content: "x", selects: [menu()] }).ok);
  });

  test("makes up a value for a choice that has none, and refuses two the same", () => {
    const made = parseMessage({ content: "x", selects: [menu({ options: [{ label: "A" }, { label: "B" }] })] });
    assert.ok(made.ok);
    assert.notEqual(made.value.selects[0]?.options[0]?.value, made.value.selects[0]?.options[1]?.value);
    assert.ok(!parseMessage({ content: "x", selects: [menu({ options: [{ label: "A", value: "v" }, { label: "B", value: "v" }] })] }).ok);
  });

  test("a menu of choices needs at least one, each with a label", () => {
    assert.ok(!parseMessage({ content: "x", selects: [menu({ options: [] })] }).ok);
    assert.ok(!parseMessage({ content: "x", selects: [menu({ options: [{ label: "" }] })] }).ok);
  });

  test("limits how many can be picked to how many choices there are", () => {
    assert.ok(parseMessage({ content: "x", selects: [menu({ maxValues: 2 })] }).ok);
    assert.ok(!parseMessage({ content: "x", selects: [menu({ maxValues: 3 })] }).ok);
    assert.ok(!parseMessage({ content: "x", selects: [menu({ minValues: 2, maxValues: 1 })] }).ok);
  });

  test("a menu of members, roles or channels has no choices of its own", () => {
    const result = parseMessage({ content: "x", selects: [{ kind: "role", options: [{ label: "ignored" }], action: { type: "none" } }] });
    assert.ok(result.ok);
    assert.deepEqual(result.value.selects[0]?.options, []);
  });

  test("a channel menu keeps only channel types Discord has", () => {
    const result = parseMessage({ content: "x", selects: [{ kind: "channel", channelTypes: [0, 2, 99] }] });
    assert.ok(result.ok);
    assert.deepEqual(result.value.selects[0]?.channelTypes, [0, 2]);
  });

  test("buttons and menus share five rows", () => {
    const buttons = Array.from({ length: 10 }, (_, i) => ({ label: `b${i}`, url: "https://example.com" }));
    assert.ok(parseMessage({ content: "x", buttons, selects: [menu(), menu(), menu()] }).ok);
    assert.ok(!parseMessage({ content: "x", buttons, selects: [menu(), menu(), menu(), menu()] }).ok);
  });
});

describe("sending as another name", () => {
  const channelId = "123456789012345678";

  test("a name and a picture go together", () => {
    assert.ok(parseSendOptions({ channelId, asName: "Announcer", asAvatarUrl: "https://example.com/a.png" }).ok);
    assert.ok(!parseSendOptions({ channelId, asAvatarUrl: "https://example.com/a.png" }).ok);
    assert.ok(!parseSendOptions({ channelId, asName: "A", asAvatarUrl: "ftp://x" }).ok);
    assert.ok(!parseSendOptions({ channelId, asName: "x".repeat(81) }).ok);
  });
});

describe("menus limited to particular channels or roles", () => {
  const ids = ["123456789012345678", "223456789012345678"];

  test("keeps the ids for a channel or role menu and drops them for others", () => {
    const channel = parseMessage({ content: "x", selects: [{ kind: "channel", limitTo: ids }] });
    assert.ok(channel.ok);
    assert.deepEqual(channel.value.selects[0]?.limitTo, ids);
    const user = parseMessage({ content: "x", selects: [{ kind: "user", limitTo: ids }] });
    assert.ok(user.ok);
    assert.deepEqual(user.value.selects[0]?.limitTo, []);
  });

  test("caps how many can be picked at how many are offered, and refuses bad ids", () => {
    assert.ok(parseMessage({ content: "x", selects: [{ kind: "role", limitTo: ids, maxValues: 2 }] }).ok);
    assert.ok(!parseMessage({ content: "x", selects: [{ kind: "role", limitTo: ids, maxValues: 3 }] }).ok);
    assert.ok(!parseMessage({ content: "x", selects: [{ kind: "channel", limitTo: ["general"] }] }).ok);
  });
});

describe("restrictMessage and linksOnly", () => {
  const message = () => {
    const result = parseMessage({
      content: "Hi",
      reactions: ["🎉"],
      buttons: [
        { label: "Docs", style: "link", url: "https://example.com" },
        { label: "Press", style: "primary" },
      ],
      selects: [
        { kind: "string", placeholder: "Pick", options: [{ label: "A", value: "a" }] },
        { kind: "role", placeholder: "Role" },
        { kind: "user", placeholder: "User" },
      ],
    });
    assert.ok(result.ok);
    return result.value;
  };

  test("a direct message keeps every button and the text menus, and loses reactions", () => {
    const kept = restrictMessage(message(), "dm");
    assert.equal(kept.buttons.length, 2);
    assert.deepEqual(kept.selects.map((select) => select.kind), ["string"]);
    assert.deepEqual(kept.reactions, []);
  });

  test("a channel post is left as it was", () => {
    const original = message();
    assert.equal(restrictMessage(original, "channel"), original);
  });

  test("turning components off removes every button and menu either way", () => {
    for (const delivery of ["channel", "dm"] as const) {
      const bare = restrictMessage(message(), delivery, false);
      assert.deepEqual(bare.buttons, []);
      assert.deepEqual(bare.selects, []);
    }
    assert.equal(restrictMessage(message(), "channel", false).reactions.length, 1);
  });

  test("linksOnly keeps link buttons and nothing else that needs an answer", () => {
    const kept = linksOnly(message());
    assert.deepEqual(kept.buttons.map((button) => button.style), ["link"]);
    assert.deepEqual(kept.selects, []);
    assert.deepEqual(kept.reactions, []);
  });
});

describe("embedReply", () => {
  test("is a sentence in a coloured embed with no text above it", () => {
    const body = embedReply("That did not work.", "error");
    assert.equal(body.content, "");
    assert.equal(body.embeds.length, 1);
    assert.equal(body.embeds[0]?.description, "That did not work.");
    assert.equal(body.embeds[0]?.color, REPLY_COLOR.error);
    assert.equal(parseMessage(body).ok, true);
  });

  test("keeps a ping above the embed, where it notifies", () => {
    const body = embedReply("Welcome in.", "info", { ping: "<@1>" });
    assert.equal(body.content, "<@1>");
  });

  test("gives each kind its own colour", () => {
    assert.equal(new Set(Object.values(REPLY_COLOR)).size, 4);
  });
});

describe("flattenEmbeds", () => {
  test("writes title, description, fields and footer as text under the existing content", () => {
    const body = {
      ...embedReply("Body text", "info", { ping: "<@1>", title: "Heads up" }),
      embeds: [
        { ...embed({ title: "Heads up", description: "Body text", footerText: "Case 4" }), fields: [{ name: "Reason", value: "Spam", inline: false }] },
      ],
    };
    const flat = flattenEmbeds(body);
    assert.deepEqual(flat.embeds, []);
    assert.equal(flat.content, "<@1>\n\n**Heads up**\nBody text\nReason: Spam\nCase 4");
  });

  test("keeps buttons, menus and reactions", () => {
    const button = { label: "Go", emoji: "", style: "primary", url: "", disabled: false, action: { type: "none" } } as const;
    const flat = flattenEmbeds({ ...embedReply("Hi"), buttons: [button], reactions: ["x"] });
    assert.equal(flat.buttons.length, 1);
    assert.deepEqual(flat.reactions, ["x"]);
  });

  test("stays within the 2000 characters a message may hold", () => {
    const flat = flattenEmbeds(embedReply("x".repeat(4000)));
    assert.equal(flat.content.length, 2000);
  });

  test("leaves a message without embeds as it was", () => {
    const flat = flattenEmbeds({ ...embedReply(""), content: "Plain", embeds: [] });
    assert.equal(flat.content, "Plain");
  });
});
