import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { COLOURS } from "../dist/image.js";
import { COLOUR_LENGTH, GLYPHS, MOTION_LENGTH, ROUND_TYPES, TEXT_LENGTH, drawCode, judge, makePlan, makeRound, type Round } from "../dist/rounds.js";
import { ALPHABET } from "../dist/strokes.js";
import { SHAPES } from "../dist/tiles.js";

describe("every kind of round", () => {
  for (const type of ROUND_TYPES) {
    test(`${type} is made and can be answered`, () => {
      for (let i = 0; i < 100; i++) {
        const round = makeRound(type);
        assert.equal(round.type, type);
        if (round.type !== "question") assert.ok(round.answer.length > 0);
      }
    });
  }
});

describe("the picture rounds", () => {
  test("text: a code of distinct characters from the alphabet, which is its answer", () => {
    for (let i = 0; i < 200; i++) {
      const round = makeRound("text");
      if (round.type !== "text") throw new Error("wrong type");
      const characters = [...round.image.code];
      assert.equal(characters.length, TEXT_LENGTH);
      assert.equal(new Set(characters).size, TEXT_LENGTH);
      for (const character of characters) assert.ok(ALPHABET.includes(character));
      assert.equal(round.answer, round.image.code.toLowerCase());
      assert.equal(round.image.colours, undefined);
    }
  });

  test("motion: a code of distinct characters from the alphabet, which is its answer", () => {
    for (let i = 0; i < 100; i++) {
      const round = makeRound("motion");
      if (round.type !== "motion") throw new Error("wrong type");
      assert.equal(new Set(round.image.code).size, MOTION_LENGTH);
      assert.equal(round.answer, round.image.code.toLowerCase());
    }
  });

  test("colour: the answer is the characters drawn in the colour asked for, in order", () => {
    for (let i = 0; i < 300; i++) {
      const round = makeRound("colour");
      if (round.type !== "colour") throw new Error("wrong type");
      const colours = round.image.colours!;
      assert.equal(colours.length, COLOUR_LENGTH);
      const asked = COLOURS[round.values.colour!]!;
      assert.ok(asked);
      const expected = [...round.image.code].filter((_, index) => colours[index] === asked).join("").toLowerCase();
      assert.equal(round.answer, expected);
      const asks = colours.filter((colour) => colour === asked).length;
      assert.ok(asks >= 2 && asks <= 3, `${asks} characters in the asked colour`);
    }
  });

  test("colour: shows two or three colours, and never red with green", () => {
    for (let i = 0; i < 300; i++) {
      const round = makeRound("colour");
      if (round.type !== "colour") throw new Error("wrong type");
      const shown = new Set(round.image.colours);
      assert.ok(shown.size >= 2 && shown.size <= 3, `${shown.size} colours`);
      assert.ok(!(shown.has(COLOURS.red!) && shown.has(COLOURS.green!)));
    }
  });
});

describe("the tile round", () => {
  test("has nine squares, and its answer is the numbers of the ones with the shape asked for", () => {
    for (let i = 0; i < 300; i++) {
      const round = makeRound("tiles");
      if (round.type !== "tiles") throw new Error("wrong type");
      assert.equal(round.tiles.shapes.length, 9);
      const wanted = round.values.shape!;
      assert.ok((SHAPES as readonly string[]).includes(wanted));
      const numbers = round.tiles.shapes.flatMap((shape, index) => (shape === wanted ? [index + 1] : []));
      assert.equal(round.answer, numbers.join(""));
      assert.ok(numbers.length >= 2 && numbers.length <= 4, `${numbers.length} squares`);
    }
  });

  test("asks for each shape in turn", () => {
    const asked = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const round = makeRound("tiles");
      if (round.type === "tiles") asked.add(round.values.shape!);
    }
    assert.equal(asked.size, SHAPES.length);
  });
});

describe("the code in squares", () => {
  test("every glyph is five squares wide and seven tall", () => {
    for (const [character, rows] of Object.entries(GLYPHS)) {
      assert.equal(rows.length, 7, character);
      for (const row of rows) assert.equal(row.length, 5, character);
    }
  });

  test("is twenty-three squares wide and seven tall, and its answer is the code", () => {
    for (let i = 0; i < 50; i++) {
      const round = makeRound("block");
      if (round.type !== "block") throw new Error("wrong type");
      const lines = round.values.grid!.split("\n");
      assert.equal(lines.length, 7);
      for (const line of lines) assert.equal([...line].length, 23);
      assert.equal(round.answer.length, 4);
    }
  });

  test("with no noise, the lit squares draw the glyph", () => {
    const grid = drawCode("K7M2", (below) => below - 1);
    const lines = grid.split("\n").map((line) => [...line]);
    for (let row = 0; row < 7; row++) {
      for (let x = 0; x < 5; x++) assert.equal(lines[row]![x] !== "⬛", GLYPHS.K![row]![x] === "#");
    }
  });
});

describe("a plan", () => {
  test("takes its rounds from the kinds allowed", () => {
    for (let i = 0; i < 100; i++) {
      assert.deepEqual(makePlan(["text", "colour"], 2).map((round) => round.type).sort(), ["colour", "text"]);
    }
  });

  test("has the number of rounds asked for", () => {
    for (let i = 0; i < 100; i++) assert.equal(makePlan(["block"], 3).length, 3);
  });

  test("repeats a kind when the pool is smaller than the number of rounds", () => {
    assert.deepEqual(makePlan(["block"], 3).map((round) => round.type), ["block", "block", "block"]);
  });

  test("falls back to every kind when none is allowed", () => {
    assert.equal(makePlan([], 2).length, 2);
  });
});

describe("judging", () => {
  const round: Round = { type: "block", answer: "k7m2", values: {} };

  test("a typed round is right when the text matches", () => {
    assert.equal(judge(round, "k7m2", (_round, text) => text === "k7m2"), "correct");
    assert.equal(judge(round, "nope", (_round, text) => text === "k7m2"), "wrong");
  });
});
