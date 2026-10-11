import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  changeSubject,
  controlName,
  failureText,
  infractionSubject,
  isComposerShortcut,
  noteSubject,
  toggleName,
} from "../app/guilds/[id]/mod/members/[userId]/a11y.ts";

const key = (extra: Partial<Parameters<typeof isComposerShortcut>[0]>) => ({
  key: "n",
  code: "KeyN",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});

describe("isComposerShortcut", () => {
  test("a bare N does nothing, so typing or speech input cannot trigger it", () => {
    assert.equal(isComposerShortcut(key({})), false);
    assert.equal(isComposerShortcut(key({ key: "N", shiftKey: true })), false);
  });

  test("Alt+N starts a note", () => {
    assert.equal(isComposerShortcut(key({ altKey: true })), true);
  });

  test("Option+N on a Mac produces a dead key but the same physical key", () => {
    assert.equal(isComposerShortcut(key({ altKey: true, key: "Dead" })), true);
  });

  test("other modifiers on top are left to the browser", () => {
    assert.equal(isComposerShortcut(key({ altKey: true, ctrlKey: true })), false);
    assert.equal(isComposerShortcut(key({ altKey: true, metaKey: true })), false);
    assert.equal(isComposerShortcut(key({ altKey: true, shiftKey: true })), false);
  });

  test("Alt with another letter is ignored", () => {
    assert.equal(isComposerShortcut(key({ altKey: true, key: "m", code: "KeyM" })), false);
  });
});

describe("accessible names", () => {
  test("repeated controls get names unique to their row, starting with the visible label", () => {
    const first = controlName("Edit", noteSubject("Priya", "Oct 9, 2026"));
    const second = controlName("Edit", noteSubject("Marcus", "Oct 9, 2026"));
    assert.equal(first, "Edit, note by Priya, Oct 9, 2026");
    assert.notEqual(first, second);
    assert.ok(controlName("Purge forever", infractionSubject("Timeout", 60)).startsWith("Purge forever"));
  });

  test("subjects name the entry", () => {
    assert.equal(infractionSubject("Timeout", 60), "timeout case 60");
    assert.equal(changeSubject("Priya", "Oct 9, 2026"), "change by Priya, Oct 9, 2026");
  });

  test("toggles say whether they show or hide, and for what", () => {
    assert.equal(toggleName(false, "timeout case 60"), "Show details for timeout case 60");
    assert.equal(toggleName(true, "timeout case 60"), "Hide details for timeout case 60");
  });
});

describe("failureText", () => {
  test("puts the server's reason after what failed", () => {
    assert.equal(failureText("Could not remove the entry", "Sign in to continue."), "Could not remove the entry. Sign in to continue.");
  });

  test("falls back to the status, then to the bare failure", () => {
    assert.equal(failureText("Could not restore the note", null, 503), "Could not restore the note. The server answered 503.");
    assert.equal(failureText("Could not purge the entry", "  "), "Could not purge the entry.");
  });
});
