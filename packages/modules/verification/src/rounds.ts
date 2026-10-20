import { randomInt } from "node:crypto";
import { COLOURS, type StillSpec } from "./image.js";
import { ALPHABET } from "./strokes.js";
import { SHAPES, type TilesSpec } from "./tiles.js";

/**
 * The rounds of the captcha. A member does a few of them, each drawn from a
 * pool. Kept free of discord.js so it can be tested without a client.
 */

type Pick = (below: number) => number;

export type RoundType = "block" | "text" | "colour" | "motion" | "tiles";

export const ROUND_TYPES: readonly RoundType[] = ["block", "text", "colour", "motion", "tiles"];

export interface TypedRound {
  type: "block";
  /** Already in the form it is compared as. */
  answer: string;
  values: Record<string, string>;
}

/** A round answered by reading a picture, which is drawn from `image` when it is shown. */
export interface ImageRound {
  type: "text" | "colour" | "motion";
  /** Already in the form it is compared as. */
  answer: string;
  values: Record<string, string>;
  image: StillSpec;
}

/** A picture of nine squares with a shape in each, answered by pressing the numbers of the squares that have one shape. */
export interface TilesRound {
  type: "tiles";
  /** The numbers, from 1, of the squares to press, in order and run together: "259". */
  answer: string;
  values: Record<string, string>;
  tiles: TilesSpec;
}

/** The question a server owner wrote. Its answers live in the settings, not here. */
export interface QuestionRound {
  type: "question";
}

export type Round = TypedRound | ImageRound | TilesRound | QuestionRound;

function shuffle<T>(items: T[], pick: Pick): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function sample<T>(items: readonly T[], count: number, pick: Pick): T[] {
  return shuffle([...items], pick).slice(0, count);
}

/** Five columns by seven rows. A # is a lit square. */
export const GLYPHS: Record<string, readonly string[]> = {
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
};

const OFF = "⬛";
const LIT = ["🟦", "🟩", "🟥", "🟨", "🟪", "🟧"];
export const CODE_LENGTH = 4;

/** Draws a code as a grid of coloured squares: each character its own colour, and a few stray squares of noise. */
export function drawCode(code: string, pick: Pick): string {
  const colours = [...code].map(() => LIT[pick(LIT.length)]!);
  const noise = 0.05 + pick(6) / 100;
  const lines: string[] = [];
  for (let row = 0; row < 7; row++) {
    let line = "";
    [...code].forEach((character, index) => {
      for (const cell of GLYPHS[character]![row]!) {
        if (cell === "#") line += colours[index];
        else line += pick(1000) < noise * 1000 ? LIT[pick(LIT.length)]! : OFF;
      }
      if (index < code.length - 1) line += OFF;
    });
    lines.push(line);
  }
  return lines.join("\n");
}

function blockRound(pick: Pick): TypedRound {
  const code = sample(Object.keys(GLYPHS), CODE_LENGTH, pick).join("");
  return { type: "block", answer: code.toLowerCase(), values: { grid: drawCode(code, pick) } };
}

export const TEXT_LENGTH = 5;
export const COLOUR_LENGTH = 7;
/** Fewer, so each can be drawn bigger: letters seen only in motion need the room. */
export const MOTION_LENGTH = 4;

function newSeed(pick: Pick): number {
  return pick(2 ** 31);
}

function textRound(pick: Pick): ImageRound {
  const code = sample(ALPHABET, TEXT_LENGTH, pick).join("");
  return { type: "text", answer: code.toLowerCase(), values: {}, image: { code, seed: newSeed(pick) } };
}

function motionRound(pick: Pick): ImageRound {
  const code = sample(ALPHABET, MOTION_LENGTH, pick).join("");
  return { type: "motion", answer: code.toLowerCase(), values: {}, image: { code, seed: newSeed(pick) } };
}

/** One shape is asked for, and shows in two, three or four of the nine squares. */
function tilesRound(pick: Pick): TilesRound {
  const wanted = SHAPES[pick(SHAPES.length)]!;
  const others = SHAPES.filter((shape) => shape !== wanted);
  const count = 2 + pick(3);
  const at = new Set(sample([0, 1, 2, 3, 4, 5, 6, 7, 8], count, pick));
  const shapes = Array.from({ length: 9 }, (_, index) => (at.has(index) ? wanted : others[pick(others.length)]!));
  const answer = [...at].sort((a, b) => a - b).map((index) => index + 1).join("");
  return { type: "tiles", answer, values: { shape: wanted }, tiles: { shapes, seed: newSeed(pick) } };
}

/** Red and green are left out of the same picture: they are the pair people with colour blindness mix up. */
function colourNames(pick: Pick): string[] {
  const names = Object.keys(COLOURS);
  for (;;) {
    const chosen = sample(names, 2 + pick(2), pick);
    if (!(chosen.includes("red") && chosen.includes("green"))) return chosen;
  }
}

/** A code in two or three colours, where the member types only the characters in one of them. */
function colourRound(pick: Pick): ImageRound {
  const code = sample(ALPHABET, COLOUR_LENGTH, pick).join("");
  const [asked, ...others] = colourNames(pick) as [string, ...string[]];
  const wanted = 2 + pick(2);
  const names: string[] = Array(wanted).fill(asked);
  // Every other colour shows at least once, so the picture really has more than one.
  names.push(...others);
  while (names.length < COLOUR_LENGTH) names.push(others[pick(others.length)]!);
  const arranged = shuffle(names, pick);
  const answer = [...code].filter((_, index) => arranged[index] === asked).join("");
  return {
    type: "colour",
    answer: answer.toLowerCase(),
    values: { colour: asked },
    image: { code, colours: arranged.map((name) => COLOURS[name]!), seed: newSeed(pick) },
  };
}

const MAKERS: Record<RoundType, (pick: Pick) => Round> = {
  block: blockRound,
  text: textRound,
  colour: colourRound,
  motion: motionRound,
  tiles: tilesRound,
};

export function makeRound(type: RoundType, pick: Pick = randomInt): Round {
  return MAKERS[type](pick);
}

/**
 * The rounds one member does: different types where the pool allows, in a
 * random order. A pool smaller than the count repeats a type, which draws a
 * fresh round each time.
 */
export function makePlan(types: readonly RoundType[], count: number, pick: Pick = randomInt): Round[] {
  const pool = types.length > 0 ? types : ROUND_TYPES;
  const chosen = sample(pool, Math.min(count, pool.length), pick);
  while (chosen.length < count) chosen.push(pool[pick(pool.length)]!);
  return shuffle(chosen, pick).map((type) => makeRound(type, pick));
}

/** Whether the round has a picture sent with it. */
export function hasPicture(round: Round): round is ImageRound | TilesRound {
  return round.type === "tiles" || "image" in round;
}

/**
 * The least time, in milliseconds, in which a person can read a round and type
 * its answer. An answer sooner than this came from something that did not read
 * it. Well under what the quickest person manages, since the time counted
 * starts when the bot sends the round and the member only sees it a moment later.
 */
export function minimumTime(round: Round): number {
  switch (round.type) {
    case "text":
      return 1500;
    case "block":
    case "colour":
      return 2000;
    case "motion":
    case "tiles":
      return 2500;
    case "question":
      return 0;
  }
}

/** Whether the text a member typed settles the round. `isAnswer` says whether it matches, since only the question's answers are settings. */
export function judge(round: Round, text: string, isAnswer: (round: Round, text: string) => boolean): "correct" | "wrong" {
  return isAnswer(round, text) ? "correct" : "wrong";
}
