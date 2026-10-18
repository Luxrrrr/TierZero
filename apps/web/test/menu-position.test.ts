import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isContextMenuKey, isKeyboardContextMenu, placeMenu, typeAheadIndex } from "../lib/menu-position.ts";

const SCREEN = { width: 1000, height: 800 };
const MENU = { width: 220, height: 300 };

describe("placeMenu", () => {
  test("opens down and to the right of the point when there is room", () => {
    const placed = placeMenu({ x: 100, y: 100 }, MENU, SCREEN);
    assert.deepEqual(placed, { left: 100, top: 100, maxHeight: null, originX: "left", originY: "top" });
  });

  test("flips to the left of the point near the right edge", () => {
    const placed = placeMenu({ x: 900, y: 100 }, MENU, SCREEN);
    assert.equal(placed.left, 680);
    assert.equal(placed.originX, "right");
  });

  test("flips above the point near the bottom edge", () => {
    const placed = placeMenu({ x: 100, y: 700 }, MENU, SCREEN);
    assert.equal(placed.top, 400);
    assert.equal(placed.originY, "bottom");
  });

  test("flips both ways in the bottom right corner", () => {
    const placed = placeMenu({ x: 990, y: 790 }, MENU, SCREEN);
    assert.deepEqual([placed.left, placed.top, placed.originX, placed.originY], [770, 490, "right", "bottom"]);
  });

  test("is pushed back inside when neither side has room", () => {
    const placed = placeMenu({ x: 100, y: 100 }, { width: 220, height: 300 }, { width: 240, height: 320 });
    assert.equal(placed.left, 12);
    assert.equal(placed.top, 12);
  });

  test("a menu taller than the window fills it and scrolls inside", () => {
    const placed = placeMenu({ x: 100, y: 300 }, { width: 220, height: 900 }, SCREEN);
    assert.equal(placed.maxHeight, 784);
    assert.equal(placed.top, 8);
  });

  test("a menu wider than the window starts at the margin", () => {
    const narrow = placeMenu({ x: 150, y: 5 }, { width: 400, height: 100 }, { width: 300, height: 600 });
    assert.equal(narrow.left, 8);
  });
});

const key = (overrides: Partial<Parameters<typeof isContextMenuKey>[0]>) => ({
  key: "",
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

describe("isContextMenuKey", () => {
  test("the context menu key opens it", () => {
    assert.equal(isContextMenuKey(key({ key: "ContextMenu" })), true);
  });

  test("Shift+F10 opens it", () => {
    assert.equal(isContextMenuKey(key({ key: "F10", shiftKey: true })), true);
  });

  test("F10 alone, or with another modifier, does not", () => {
    assert.equal(isContextMenuKey(key({ key: "F10" })), false);
    assert.equal(isContextMenuKey(key({ key: "F10", shiftKey: true, ctrlKey: true })), false);
    assert.equal(isContextMenuKey(key({ key: "F10", shiftKey: true, altKey: true })), false);
    assert.equal(isContextMenuKey(key({ key: "Enter" })), false);
  });
});

describe("isKeyboardContextMenu", () => {
  test("an event at the corner of the window came from the keyboard", () => {
    assert.equal(isKeyboardContextMenu({ clientX: 0, clientY: 0 }), true);
    assert.equal(isKeyboardContextMenu({ clientX: 120, clientY: 44 }), false);
  });
});

describe("typeAheadIndex", () => {
  const labels = ["Warn author", "Timeout author", "Kick author", "Ban author", "Copy message text"];

  test("goes to the next item that starts with the letter", () => {
    assert.equal(typeAheadIndex(labels, -1, "k"), 2);
    assert.equal(typeAheadIndex(labels, 2, "b"), 3);
  });

  test("wraps round and moves on through items sharing a letter", () => {
    assert.equal(typeAheadIndex(labels, 4, "w"), 0);
    assert.equal(typeAheadIndex(["Copy ID", "Copy link"], 0, "c"), 1);
  });

  test("is not case sensitive, and ignores a space and a missing match", () => {
    assert.equal(typeAheadIndex(labels, 0, "T"), 1);
    assert.equal(typeAheadIndex(labels, 0, " "), -1);
    assert.equal(typeAheadIndex(labels, 0, "z"), -1);
  });
});
