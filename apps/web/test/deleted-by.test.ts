import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deletedByLabel, deletedByTitle, noTextLabel } from "../lib/deleted-by.ts";

describe("deletedByLabel", () => {
  const table: Array<[Parameters<typeof deletedByLabel>[0], string | null | undefined, string]> = [
    ["automod", "Automod", "Deleted by Automod"],
    ["automod", null, "Deleted by Automod"],
    ["moderator", "Marcus", "Deleted by Marcus (moderator)"],
    ["moderator", null, "Deleted by a moderator"],
    ["author", "LuxTester", "Deleted by LuxTester (the author)"],
    ["author", "", "Deleted by the author"],
    ["bot", "TierZero", "Deleted by TierZero (bot)"],
    ["bot", undefined, "Deleted by the bot"],
    [null, null, "Deleted"],
    [undefined, "Marcus", "Deleted"],
  ];
  for (const [by, name, expected] of table) {
    test(expected + (name ? ` / ${name}` : ""), () => assert.equal(deletedByLabel(by, name), expected));
  }

  test("every source has hover text, and unknown says the log could not tell", () => {
    for (const by of ["automod", "author", "bot", "moderator"] as const) assert.ok(deletedByTitle(by).length > 0);
    assert.match(deletedByTitle(null), /could not tell/);
  });
});

describe("noTextLabel", () => {
  const table: Array<[number, string, string]> = [
    [0, "", "No text."],
    [1, "", "No text, 1 attachment"],
    [3, "", "No text, 3 attachments"],
    [0, "1 sticker", "No text, 1 sticker"],
    [1, "1 embed", "No text, 1 attachment, 1 embed"],
  ];
  for (const [files, extras, expected] of table) {
    test(expected, () => assert.equal(noTextLabel(files, extras), expected));
  }
});
