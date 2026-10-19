import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GLYPHS, ROUND_TYPES, drawCode, judge, makePlan, makeRound, type Round } from "../dist/rounds.js";

const anyText = () => true;

describe("every kind of round", () => {
  for (const type of ROUND_TYPES) {
    test(`${type} is made, can be answered, and its buttons do not give it away`, () => {
      for (let i = 0; i < 100; i++) {
        const round = makeRound(type);
        assert.equal(round.type, type);
        if ("choices" in round) {
          const tokens = round.choices.map((choice) => choice.token);
          assert.equal(new Set(tokens).size, tokens.length);
          for (const choice of round.choices) assert.match(choice.token, /^[0-9a-f]{8}$/);
          const answers = Array.isArray(round.answer) ? round.answer : [round.answer];
          for (const answer of answers) assert.ok(tokens.includes(answer));
        } else if (round.type !== "question") {
          assert.ok(round.answer.length > 0);
        }
      }
    });
  }
});

describe("the button rounds", () => {
  test("pictures: six buttons, and a picture and name to press", () => {
    const round = makeRound("pictures");
    if (round.type !== "pictures") throw new Error("wrong type");
    assert.equal(round.choices.length, 6);
    assert.match(round.values.symbol!, /\S+ \w+/);
  });

  test("count: the right button is the number of pictures shown", () => {
    for (let i = 0; i < 200; i++) {
      const round = makeRound("count");
      if (round.type !== "count") throw new Error("wrong type");
      const shown = round.values.row!.split(" ").length;
      const right = round.choices.find((choice) => choice.token === round.answer);
      assert.equal(right?.label, String(shown));
      assert.equal(new Set(round.choices.map((choice) => choice.label)).size, round.choices.length);
    }
  });

  test("odd: five buttons alike and one different, and the different one is right", () => {
    for (let i = 0; i < 200; i++) {
      const round = makeRound("odd");
      if (round.type !== "odd") throw new Error("wrong type");
      const counts = new Map<string, number>();
      for (const choice of round.choices) counts.set(choice.emoji!, (counts.get(choice.emoji!) ?? 0) + 1);
      assert.deepEqual([...counts.values()].sort(), [1, 5]);
      const right = round.choices.find((choice) => choice.token === round.answer)!;
      assert.equal(counts.get(right.emoji!), 1);
    }
  });

  test("belong: four different pictures", () => {
    for (let i = 0; i < 200; i++) {
      const round = makeRound("belong");
      if (round.type !== "belong") throw new Error("wrong type");
      assert.equal(round.choices.length, 4);
      assert.equal(new Set(round.choices.map((choice) => choice.emoji)).size, 4);
    }
  });

  test("order: three pictures to press from the smallest", () => {
    for (let i = 0; i < 100; i++) {
      const round = makeRound("order");
      if (round.type !== "order") throw new Error("wrong type");
      assert.equal(round.choices.length, 3);
      assert.equal(round.answer.length, 3);
    }
  });
});

describe("the typed rounds", () => {
  test("a puzzle has the answer its question implies", () => {
    for (let i = 0; i < 300; i++) {
      const round = makeRound("typed");
      if (round.type !== "typed") throw new Error("wrong type");
      const question = round.values.question!;
      const sum = /What is (\d+) \+ (\d+)\?/.exec(question);
      const difference = /What is (\d+) − (\d+)\?/.exec(question);
      const product = /What is (\d+) × (\d+)\?/.exec(question);
      const word = /\*\*(\w+)\*\* backwards/.exec(question);
      if (sum) assert.equal(round.answer, String(Number(sum[1]) + Number(sum[2])));
      else if (difference) {
        assert.equal(round.answer, String(Number(difference[1]) - Number(difference[2])));
        assert.ok(Number(round.answer) >= 0);
      } else if (product) assert.equal(round.answer, String(Number(product[1]) * Number(product[2])));
      else if (word) assert.equal(round.answer, [...word[1]!].reverse().join(""));
      else assert.fail(`unrecognised question ${question}`);
    }
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
  test("has the number of rounds asked for, from the kinds allowed", () => {
    for (let i = 0; i < 100; i++) {
      const plan = makePlan(["count", "odd", "block"], 3);
      assert.equal(plan.length, 3);
      assert.deepEqual(plan.map((round) => round.type).sort(), ["block", "count", "odd"]);
    }
  });

  test("repeats a kind when the pool is smaller than the number of rounds", () => {
    const plan = makePlan(["count"], 3);
    assert.deepEqual(plan.map((round) => round.type), ["count", "count", "count"]);
  });

  test("falls back to every kind when none is allowed", () => {
    assert.equal(makePlan([], 2).length, 2);
  });
});

describe("judging", () => {
  const button = (): Round => ({ type: "odd", choices: [{ token: "a" }, { token: "b" }], answer: "a", values: {} });

  test("a button round is right only for its answer", () => {
    assert.equal(judge(button(), [], { kind: "token", token: "a" }, anyText), "correct");
    assert.equal(judge(button(), [], { kind: "token", token: "b" }, anyText), "wrong");
    assert.equal(judge(button(), [], { kind: "text", text: "a" }, anyText), "wrong");
  });

  test("an order round is judged once every button is in", () => {
    const round: Round = { type: "order", choices: [{ token: "a" }, { token: "b" }], answer: ["a", "b"], values: {} };
    assert.equal(judge(round, [], { kind: "token", token: "z" }, anyText), "wrong");
    assert.equal(judge(round, [], { kind: "token", token: "a" }, anyText), "more");
    assert.equal(judge(round, ["a"], { kind: "token", token: "b" }, anyText), "correct");
    assert.equal(judge(round, ["b"], { kind: "token", token: "a" }, anyText), "wrong");
  });
});
