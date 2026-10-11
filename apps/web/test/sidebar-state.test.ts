import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSidebarShortcut, parseSidebarMode, shortcutLabel, toggledMode } from "../lib/sidebar-state.ts";

const press = (over: Partial<Parameters<typeof isSidebarShortcut>[0]> = {}) => ({
  key: "b",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("parseSidebarMode", () => {
  test("only the stored word collapsed collapses it", () => {
    assert.equal(parseSidebarMode("collapsed"), "collapsed");
    assert.equal(parseSidebarMode("expanded"), "expanded");
    assert.equal(parseSidebarMode("nonsense"), "expanded");
    assert.equal(parseSidebarMode(null), "expanded");
    assert.equal(parseSidebarMode(undefined), "expanded");
  });
});

describe("toggledMode", () => {
  test("flips between the two", () => {
    assert.equal(toggledMode("expanded"), "collapsed");
    assert.equal(toggledMode("collapsed"), "expanded");
  });
});

describe("isSidebarShortcut", () => {
  test("accepts Ctrl+B and Cmd+B", () => {
    assert.equal(isSidebarShortcut(press({ ctrlKey: true })), true);
    assert.equal(isSidebarShortcut(press({ metaKey: true })), true);
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, key: "B" })), true);
  });

  test("never fires on a bare key", () => {
    assert.equal(isSidebarShortcut(press()), false);
  });

  test("ignores other letters and extra modifiers", () => {
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, key: "n" })), false);
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, shiftKey: true })), false);
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, altKey: true })), false);
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, metaKey: true })), false);
  });

  test("ignores key repeat so holding it does not flicker the rail", () => {
    assert.equal(isSidebarShortcut(press({ ctrlKey: true, repeat: true })), false);
  });
});

describe("shortcutLabel", () => {
  test("names the modifier for the platform", () => {
    assert.equal(shortcutLabel(true), "⌘B");
    assert.equal(shortcutLabel(false), "Ctrl+B");
  });
});
