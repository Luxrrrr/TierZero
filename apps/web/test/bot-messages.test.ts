import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { embedReply, plainReply, s, type MessageBody } from "@tier0/core";
import {
  collectMessageRows,
  contextFreeHelp,
  countByModule,
  featureSearch,
  featureSummaries,
  filterRows,
  getAt,
  groupBySection,
  isCustomized,
  isSectionOpen,
  kindOf,
  messageText,
  MOST_CHANGED,
  parseFeatureParam,
  pathOf,
  resolveMostChanged,
  sectionsStartOpen,
  setAt,
  storedMessage,
  viewOf,
  type BotMessageRow,
  type ModuleInput,
  type RowView,
} from "../lib/bot-messages.ts";

const say = (content: string): MessageBody => plainReply(content);

const sample = (label: string, starting: string, extra: { help?: string } = {}) =>
  s.message({ label, starting: say(starting), variables: [{ name: "role", description: "The role", sample: "Events" }], ...extra });

function moduleFrom(id: string, name: string, settings: ReturnType<typeof s.object>, extra: Partial<ModuleInput> = {}): ModuleInput {
  return { id, name, enabled: true, schema: settings.describe(), commands: [], ...extra };
}

const welcome = moduleFrom(
  "welcome",
  "Welcome",
  s.object({
    channel: s.channel({ optional: true }),
    greeting: sample("Greeting", "Welcome {user}!", { help: "Sent when someone joins." }),
    replies: s.object(
      {
        errors: s.object({ failed: sample("When it fails", "It failed.") }, { label: "Errors" }),
        done: sample("When it works", "Done."),
      },
      { label: "Replies and errors", collapsible: true },
    ),
  }),
);

const roles = moduleFrom(
  "roles",
  "Self-service roles",
  s.object({
    menus: s.array(
      s.object({
        name: s.string({ label: "Name" }),
        message: sample("Menu message", "Pick a role."),
        note: s.string({ optional: true }),
      }),
      { label: "Role menus" },
    ),
    replies: s.object({ gave: sample("When a role is given", "You now have {role}.") }, { label: "Replies" }),
  }),
  { enabled: false },
);

const system = moduleFrom("system", "Bot replies", s.object({ replies: s.object({ gone: sample("A role is gone", "Gone.") }, { label: "Replies" }) }), {
  alwaysOn: true,
  enabled: true,
});

const resolveDefaults = (module: ModuleInput): Record<string, unknown> => {
  const fields = module.schema.fields as Record<string, { kind: string; default?: unknown }>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) if (field.kind === "array") out[key] = [];
  return out;
};

describe("pathOf", () => {
  test("writes a place the way the bot names it", () => {
    assert.equal(pathOf(["menus", 0, "message"]), "menus[0].message");
    assert.equal(pathOf(["replies", "errors", "failed"]), "replies.errors.failed");
  });
});

describe("collectMessageRows", () => {
  test("finds a message directly under the settings and ones inside groups", () => {
    const rows = collectMessageRows([welcome], { welcome: {} });
    assert.deepEqual(
      rows.map((row) => [row.label, row.trail, row.anchor]),
      [
        ["Greeting", [], "group-general"],
        ["When it fails", ["Replies and errors", "Errors"], "group-replies"],
        ["When it works", ["Replies and errors"], "group-replies"],
      ],
    );
  });

  test("carries what the editor needs", () => {
    const [row] = collectMessageRows([welcome], { welcome: {} });
    assert.equal(row?.help, "Sent when someone joins.");
    assert.equal(row?.starting.content, "Welcome {user}!");
    assert.equal(row?.variables[0]?.name, "role");
    assert.equal(row?.delivery, "channel");
    assert.equal(row?.components, true);
    assert.equal(row?.kind, "setting");
    assert.deepEqual(row?.segments, ["greeting"]);
  });

  test("finds a message in every entry of a list, named after the entry", () => {
    const rows = collectMessageRows([roles], { roles: { menus: [{ name: "Colours" }, { name: "" }, { name: "Games" }] } });
    const menuRows = rows.filter((row) => row.label === "Menu message");
    assert.deepEqual(menuRows.map((row) => row.trail), [["Role menus: Colours"], ["Role menus: #2"], ["Role menus: Games"]]);
    assert.deepEqual(menuRows.map((row) => pathOf(row.segments)), ["menus[0].message", "menus[1].message", "menus[2].message"]);
    assert.equal(menuRows[0]?.anchor, "group-general");
  });

  test("lists no message for a list with no entries", () => {
    const rows = collectMessageRows([roles], { roles: { menus: [] } });
    assert.deepEqual(rows.map((row) => row.label), ["When a role is given"]);
  });

  test("notes a feature that is switched off, but not one that is part of the bot", () => {
    const rows = collectMessageRows([roles, system], { roles: { menus: [] }, system: {} });
    assert.equal(rows.find((row) => row.moduleId === "roles")?.moduleOff, true);
    assert.equal(rows.find((row) => row.moduleId === "system")?.moduleOff, false);
  });

  test("lists the reply of a command that has one, and skips one that does not", () => {
    const withCommands = moduleFrom("utility", "Utility", s.object({}), {
      commands: [
        { name: "ping", kind: "slash", privateByDefault: true, response: { starting: say("Pong"), placeholders: [{ name: "roundtrip", description: "ms", sample: "84" }] } },
        { name: "Report", kind: "message", privateByDefault: true, response: null },
        { name: "serverinfo", kind: "slash", privateByDefault: false, response: { starting: say("Info"), placeholders: [] } },
      ],
    });
    const rows = collectMessageRows([withCommands], { utility: {} });
    assert.deepEqual(rows.map((row) => [row.key, row.label, row.kind, row.trail]), [
      ["utility/command:ping", "/ping", "reply", ["Command replies"]],
      ["utility/command:serverinfo", "/serverinfo", "reply", ["Command replies"]],
    ]);
    assert.equal(rows[0]?.command, "ping");
    assert.equal(rows[0]?.isPrivate, true);
    assert.equal(rows[1]?.isPrivate, false);
    assert.match(rows[0]?.help ?? "", /\/ping/);
  });

  test("gives every row its own key", () => {
    const rows = collectMessageRows([welcome, roles, system], { welcome: {}, roles: { menus: [{ name: "a" }, { name: "b" }] }, system: {} });
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  });

  test("finds nothing in a feature with no messages", () => {
    assert.deepEqual(collectMessageRows([moduleFrom("plain", "Plain", s.object({ on: s.boolean({ default: true }) }))], { plain: {} }), []);
  });
});

describe("getAt and setAt", () => {
  const settings = { replies: { gave: { content: "a" }, other: 1 }, menus: [{ name: "x", message: { content: "m" } }] };

  test("reads a nested place and a place inside a list", () => {
    assert.deepEqual(getAt(settings, ["replies", "gave"]), { content: "a" });
    assert.deepEqual(getAt(settings, ["menus", 0, "message"]), { content: "m" });
    assert.equal(getAt(settings, ["replies", "missing", "deeper"]), undefined);
  });

  test("replaces one place and leaves the rest, and the original, alone", () => {
    const next = setAt(settings, ["replies", "gave"], { content: "b" });
    assert.deepEqual(next.replies, { gave: { content: "b" }, other: 1 });
    assert.deepEqual(next.menus, settings.menus);
    assert.deepEqual(settings.replies.gave, { content: "a" });
  });

  test("replaces a place inside a list entry without touching the others", () => {
    const two = { menus: [{ name: "x", message: "m1" }, { name: "y", message: "m2" }] };
    const next = setAt(two, ["menus", 1, "message"], "new");
    assert.deepEqual(next.menus, [{ name: "x", message: "m1" }, { name: "y", message: "new" }]);
  });

  test("removes the key when the value is undefined, which sends the default back", () => {
    const next = setAt(settings, ["replies", "gave"], undefined);
    assert.deepEqual(next.replies, { other: 1 });
    assert.equal("gave" in next.replies, false);
  });

  test("makes the path when nothing was stored there yet", () => {
    assert.deepEqual(setAt({}, ["replies", "gave"], { content: "z" }), { replies: { gave: { content: "z" } } });
  });
});

describe("what a row shows", () => {
  const [greeting] = collectMessageRows([welcome], { welcome: {} }) as [BotMessageRow];

  test("is the default while nothing is stored", () => {
    const view = viewOf(greeting, { welcome: {} }, {});
    assert.equal(view.edited, false);
    assert.equal(view.body.content, "Welcome {user}!");
  });

  test("is the default when what is stored is the default", () => {
    const view = viewOf(greeting, { welcome: { greeting: say("Welcome {user}!") } }, {});
    assert.equal(view.edited, false);
  });

  test("is the edited message once the owner changed it", () => {
    const view = viewOf(greeting, { welcome: { greeting: say("Hello {user}") } }, {});
    assert.equal(view.edited, true);
    assert.equal(view.body.content, "Hello {user}");
  });

  test("reads a message stored as plain text", () => {
    const view = viewOf(greeting, { welcome: { greeting: "Hey there" } }, {});
    assert.equal(view.edited, true);
    assert.equal(view.body.content, "Hey there");
  });

  test("ignores something stored that is no longer a message", () => {
    const view = viewOf(greeting, { welcome: { greeting: 42 } }, {});
    assert.equal(view.edited, false);
  });

  test("a command reply is edited once the owner wrote one", () => {
    const utility = moduleFrom("utility", "Utility", s.object({}), {
      commands: [{ name: "ping", kind: "slash", privateByDefault: true, response: { starting: say("Pong"), placeholders: [] } }],
    });
    const [reply] = collectMessageRows([utility], { utility: {} }) as [BotMessageRow];
    assert.equal(viewOf(reply, { utility: {} }, { ping: null }).edited, false);
    const view = viewOf(reply, { utility: {} }, { ping: say("Pong, {sender}") });
    assert.equal(view.edited, true);
    assert.equal(view.body.content, "Pong, {sender}");
  });

  test("storedMessage and isCustomized agree on what counts as changed", () => {
    assert.equal(storedMessage(undefined), null);
    assert.equal(storedMessage("   "), null);
    assert.equal(isCustomized(null, say("a")), false);
    assert.equal(isCustomized(say("a"), say("a")), false);
    assert.equal(isCustomized(say("b"), say("a")), true);
  });
});

describe("messageText", () => {
  test("gathers the text, the embed words and the button labels", () => {
    const message: MessageBody = {
      ...say("Hello"),
      embeds: [
        {
          title: "Rules",
          description: "Be kind",
          authorName: "Staff",
          footerText: "Thanks",
          fields: [{ name: "One", value: "No spam", inline: false }],
        } as never,
      ],
      buttons: [{ label: "Accept", emoji: "", style: "primary", url: "", disabled: false, action: { type: "none" } } as never],
    };
    const text = messageText(message);
    for (const word of ["Hello", "Rules", "Be kind", "Staff", "Thanks", "One", "No spam", "Accept"]) assert.ok(text.includes(word), word);
  });
});

describe("filterRows", () => {
  const modules = [welcome, roles, system];
  const settings = {
    welcome: { greeting: say("Welcome aboard, {user}!") },
    roles: { menus: [{ name: "Colours" }] },
    system: {},
  };
  const rows = collectMessageRows(modules, settings);
  const views = new Map<string, RowView>(rows.map((row) => [row.key, viewOf(row, settings, {})]));
  const labels = (found: BotMessageRow[]) => found.map((row) => row.label);
  const nothing = { query: "", moduleId: null, editedOnly: false };

  test("keeps everything when nothing is asked", () => {
    assert.equal(filterRows(rows, views, nothing).length, rows.length);
  });

  test("matches the name of a message", () => {
    assert.deepEqual(labels(filterRows(rows, views, { ...nothing, query: "greeting" })), ["Greeting"]);
  });

  test("matches the help that says when it is sent", () => {
    assert.deepEqual(labels(filterRows(rows, views, { ...nothing, query: "someone joins" })), ["Greeting"]);
  });

  test("matches the name of the feature", () => {
    const found = filterRows(rows, views, { ...nothing, query: "self-service" });
    assert.ok(found.length > 0);
    assert.ok(found.every((row) => row.moduleId === "roles"));
  });

  test("matches the words the message says now, not only the default", () => {
    assert.deepEqual(labels(filterRows(rows, views, { ...nothing, query: "aboard" })), ["Greeting"]);
  });

  test("matches the group a message sits under", () => {
    const found = filterRows(rows, views, { ...nothing, query: "replies and errors" });
    assert.deepEqual(labels(found), ["When it fails", "When it works"]);
  });

  test("needs every word, in any order, and ignores case", () => {
    assert.deepEqual(labels(filterRows(rows, views, { ...nothing, query: "JOINS  greeting" })), ["Greeting"]);
    assert.deepEqual(filterRows(rows, views, { ...nothing, query: "greeting colours" }), []);
  });

  test("finds nothing for words that appear nowhere", () => {
    assert.deepEqual(filterRows(rows, views, { ...nothing, query: "zzzz" }), []);
  });

  test("limits to one feature", () => {
    const found = filterRows(rows, views, { ...nothing, moduleId: "system" });
    assert.deepEqual(labels(found), ["A role is gone"]);
  });

  test("limits to what has been edited", () => {
    assert.deepEqual(labels(filterRows(rows, views, { ...nothing, editedOnly: true })), ["Greeting"]);
  });

  test("combines the search, the feature and the edit filter", () => {
    assert.deepEqual(labels(filterRows(rows, views, { query: "welcome", moduleId: "welcome", editedOnly: true })), ["Greeting"]);
    assert.deepEqual(filterRows(rows, views, { query: "welcome", moduleId: "roles", editedOnly: false }), []);
  });
});

describe("counting", () => {
  const rows = collectMessageRows([welcome, roles, system], { welcome: {}, roles: { menus: [{ name: "a" }] }, system: {} });

  test("counts messages per feature", () => {
    const counts = countByModule(rows);
    assert.equal(counts.get("welcome"), 3);
    assert.equal(counts.get("roles"), 2);
    assert.equal(counts.get("system"), 1);
  });
});

describe("sections", () => {
  test("a message directly under the settings is in General, and a group is named by its path", () => {
    const rows = collectMessageRows([welcome], { welcome: {} });
    assert.deepEqual(rows.map((row) => row.section), ["General", "Replies and errors › Errors", "Replies and errors"]);
  });

  test("the entries of a list share one section and keep their own name", () => {
    const rows = collectMessageRows([roles], { roles: { menus: [{ name: "Colours" }, { name: "Games" }] } });
    const menus = rows.filter((row) => row.label === "Menu message");
    assert.deepEqual(menus.map((row) => row.section), ["Role menus", "Role menus"]);
    assert.deepEqual(menus.map((row) => row.entry), ["Colours", "Games"]);
    assert.equal(rows.find((row) => row.label === "When a role is given")?.entry, null);
  });

  test("a command reply sits under Command replies", () => {
    const utility = moduleFrom("utility", "Utility", s.object({}), {
      commands: [{ name: "ping", kind: "slash", privateByDefault: true, response: { starting: say("Pong"), placeholders: [] } }],
    });
    assert.equal(collectMessageRows([utility], { utility: {} })[0]?.section, "Command replies");
  });

  test("groups rows in the order the sections first appear, with how many are edited", () => {
    const settings = { welcome: { replies: { done: say("All good") } } };
    const rows = collectMessageRows([welcome], settings);
    const views = new Map(rows.map((row) => [row.key, viewOf(row, settings, {})]));
    const sections = groupBySection(rows, views);
    assert.deepEqual(sections.map((section) => [section.title, section.rows.length, section.edited]), [
      ["General", 1, 0],
      ["Replies and errors › Errors", 1, 0],
      ["Replies and errors", 1, 1],
    ]);
    assert.deepEqual(groupBySection([], views), []);
  });

  test("a parent shared by every nested group is left off their titles", () => {
    const row = (section: string, key: string) => ({ section, key }) as unknown as Parameters<typeof groupBySection>[0][number];
    const views = new Map() as Parameters<typeof groupBySection>[1];
    const titles = (rows: ReturnType<typeof row>[]) => groupBySection(rows, views).map((section) => section.title);
    assert.deepEqual(titles([row("General", "a"), row("Replies and errors › Refusals", "b"), row("Replies and errors › Confirmations", "c")]), ["General", "Refusals", "Confirmations"]);
    assert.deepEqual(titles([row("Replies and errors › Refusals", "b"), row("Labels › Words", "c")]), ["Replies and errors › Refusals", "Labels › Words"]);
    assert.deepEqual(titles([row("Replies and errors › Refusals", "b")]), ["Replies and errors › Refusals"]);
  });

  test("sections start open for a feature of twelve messages or fewer", () => {
    assert.equal(sectionsStartOpen(12), true);
    assert.equal(sectionsStartOpen(13), false);
  });

  test("a section the owner toggled stays as set, except that edited only opens them all", () => {
    assert.equal(isSectionOpen(undefined, false, false), false);
    assert.equal(isSectionOpen(undefined, true, false), true);
    assert.equal(isSectionOpen(true, false, false), true);
    assert.equal(isSectionOpen(false, true, false), false);
    assert.equal(isSectionOpen(false, false, true), true);
  });
});

describe("feature cards", () => {
  const plain = moduleFrom("plain", "Plain", s.object({ on: s.boolean({ default: true }) }));
  const moderation = moduleFrom("moderation", "Moderation", s.object({ dmMessage: sample("Direct message to the member", "You were warned.") }), {
    summary: "Warnings and bans.",
  });
  const tail = moduleFrom("zeta", "Zeta", s.object({ note: sample("Note", "n") }));
  const alpha = moduleFrom("alpha", "Alpha", s.object({ note: sample("Note", "n") }));
  const modules = [system, tail, plain, roles, alpha, welcome, moderation];
  const settings = { welcome: { greeting: say("Hi") }, roles: { menus: [{ name: "a" }] } };
  const rows = collectMessageRows(modules, settings);
  const views = new Map<string, RowView>(rows.map((row) => [row.key, viewOf(row, settings, {})]));
  const cards = featureSummaries(rows, views, modules);

  test("lists features with messages, the usual ones first, then the rest by name", () => {
    assert.deepEqual(cards.map((card) => card.id), ["moderation", "welcome", "roles", "system", "alpha", "zeta"]);
  });

  test("leaves out a feature with no messages", () => {
    assert.equal(cards.some((card) => card.id === "plain"), false);
  });

  test("counts messages and edited ones, and carries the summary and the off flag", () => {
    const welcomeCard = cards.find((card) => card.id === "welcome");
    assert.deepEqual([welcomeCard?.total, welcomeCard?.edited], [3, 1]);
    assert.equal(cards.find((card) => card.id === "moderation")?.summary, "Warnings and bans.");
    assert.equal(cards.find((card) => card.id === "roles")?.off, true);
    assert.equal(cards.find((card) => card.id === "system")?.off, false);
  });
});

describe("what a message is", () => {
  test("is read from the first embed's colour in the default", () => {
    assert.equal(kindOf(embedReply("No", "error")), "error");
    assert.equal(kindOf(embedReply("Yes", "success")), "success");
    assert.equal(kindOf(embedReply("Careful", "warning")), "warning");
    assert.equal(kindOf(embedReply("Note", "info")), "info");
  });

  test("is nothing for plain text or a colour chosen by hand", () => {
    assert.equal(kindOf(say("Hello")), null);
    const custom = embedReply("No", "error");
    assert.equal(kindOf({ ...custom, embeds: [{ ...custom.embeds[0]!, color: "#123456" }] }), null);
  });
});

describe("most changed", () => {
  const welcomeLike = moduleFrom("welcome", "Welcome", s.object({ join: s.object({ message: sample("Greeting message", "Hi") }) }));
  const automod = moduleFrom("automod", "Automod", s.object({ noticeMessage: sample("Notice", "Careful") }));
  const levelingOff = moduleFrom("leveling", "Leveling", s.object({ announce: s.object({ message: sample("Level-up", "Up") }) }), { enabled: false });

  const run = (modules: ModuleInput[], settings: Record<string, Record<string, unknown>>, editedOnly = false) => {
    const rows = collectMessageRows(modules, settings);
    const views = new Map<string, RowView>(rows.map((row) => [row.key, viewOf(row, settings, {})]));
    return resolveMostChanged(rows, views, editedOnly).map((item) => item.label);
  };

  test("lists at most six entries", () => {
    assert.ok(MOST_CHANGED.length <= 6);
  });

  test("skips entries whose feature or message does not exist", () => {
    assert.deepEqual(run([welcomeLike, automod], {}), ["Welcome greeting", "Automod notice"]);
    assert.deepEqual(run([], {}), []);
  });

  test("skips a message of a feature that is off and untouched, but not once it is edited", () => {
    assert.deepEqual(run([welcomeLike, levelingOff], {}), ["Welcome greeting"]);
    assert.deepEqual(run([welcomeLike, levelingOff], { leveling: { announce: { message: say("Level {level}") } } }), ["Welcome greeting", "Level-up announcement"]);
  });

  test("shows only edited ones when asked", () => {
    assert.deepEqual(run([welcomeLike, automod], { automod: { noticeMessage: say("Stop") } }, true), ["Automod notice"]);
  });

  test("points the ticket panel entry at the first panel in the list", () => {
    const tickets = moduleFrom("tickets", "Tickets", s.object({ panels: s.array(s.object({ name: s.string({ default: "" }), message: sample("Panel message", "Open a ticket") })) }));
    assert.deepEqual(run([tickets], { tickets: { panels: [{ name: "Support", message: say("Need help?") }] } }), ["Ticket panel"]);
  });
});

describe("the feature in the address", () => {
  test("is read when it names a feature the page has", () => {
    assert.equal(parseFeatureParam("welcome", ["welcome", "roles"]), "welcome");
    assert.equal(parseFeatureParam(["roles", "welcome"], ["welcome", "roles"]), "roles");
  });

  test("falls back to the cards for anything else", () => {
    assert.equal(parseFeatureParam("nope", ["welcome"]), null);
    assert.equal(parseFeatureParam(undefined, ["welcome"]), null);
    assert.equal(parseFeatureParam(null, ["welcome"]), null);
    assert.equal(parseFeatureParam([], ["welcome"]), null);
  });

  test("is written back as a query string, and nothing for the cards", () => {
    assert.equal(featureSearch("welcome"), "?feature=welcome");
    assert.equal(featureSearch(null), "");
  });
});

describe("searching across features", () => {
  const settings = { welcome: { greeting: say("Welcome aboard") }, roles: { menus: [{ name: "Colours" }] }, system: {} };
  const rows = collectMessageRows([welcome, roles, system], settings);
  const views = new Map<string, RowView>(rows.map((row) => [row.key, viewOf(row, settings, {})]));

  test("returns matches from every feature in one list", () => {
    const found = filterRows(rows, views, { query: "when", moduleId: null, editedOnly: false });
    assert.deepEqual([...new Set(found.map((row) => row.moduleId))].sort(), ["roles", "welcome"]);
  });

  test("narrows to edited messages across features", () => {
    const found = filterRows(rows, views, { query: "", moduleId: null, editedOnly: true });
    assert.deepEqual(found.map((row) => row.moduleId), ["welcome"]);
  });
});

test("every default message of the test features is a plain default, not an edit", () => {
  const rows = collectMessageRows([welcome, roles, system], { welcome: resolveDefaults(welcome), roles: resolveDefaults(roles), system: {} });
  for (const row of rows) {
    const view = viewOf(row, { welcome: {}, roles: {}, system: {} }, {});
    assert.equal(view.edited, false, row.key);
  }
});

describe("contextFreeHelp", () => {
  test("drops a sentence that points at a control on the settings page", () => {
    assert.equal(contextFreeHelp("Posted in the channel above."), "");
    assert.equal(contextFreeHelp("Sent when a member joins. Posted in the channel above."), "Sent when a member joins.");
  });

  test("keeps help that reads anywhere", () => {
    assert.equal(contextFreeHelp("Sent when a member joins."), "Sent when a member joins.");
  });
});
