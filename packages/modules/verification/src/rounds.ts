import { randomInt } from "node:crypto";

/**
 * The rounds of the captcha. A member does a few of them, each drawn from a
 * pool, and none is an image: they press buttons, put things in order, or type
 * what a grid of coloured squares says. Kept free of discord.js so it can be
 * tested without a client.
 */

type Pick = (below: number) => number;

export type RoundType = "pictures" | "count" | "odd" | "belong" | "order" | "typed" | "block";

export const ROUND_TYPES: readonly RoundType[] = ["pictures", "count", "odd", "belong", "order", "typed", "block"];

/** A button on a round. Its token is random per round and says nothing about whether it is right. */
export interface Choice {
  token: string;
  emoji?: string;
  label?: string;
}

/** What a round's message is filled in with, besides the round count. */
type Values = Record<string, string>;

export interface ButtonRound {
  type: "pictures" | "count" | "odd" | "belong";
  choices: Choice[];
  answer: string;
  values: Values;
}

export interface OrderRound {
  type: "order";
  choices: Choice[];
  /** Tokens in the order they have to be pressed. */
  answer: string[];
  values: Values;
}

export interface TypedRound {
  type: "typed" | "block";
  /** Already in the form it is compared as. */
  answer: string;
  values: Values;
}

/** The question a server owner wrote. Its answers live in the settings, not here. */
export interface QuestionRound {
  type: "question";
}

export type Round = ButtonRound | OrderRound | TypedRound | QuestionRound;

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

const HEX = "0123456789abcdef";
function newToken(pick: Pick): string {
  let token = "";
  for (let i = 0; i < 8; i++) token += HEX.charAt(pick(16));
  return token;
}

/** Tokens that cannot collide inside one round. */
function tokens(count: number, pick: Pick): string[] {
  const seen = new Set<string>();
  while (seen.size < count) seen.add(newToken(pick));
  return [...seen];
}

interface Picture {
  emoji: string;
  name: string;
}

const PICTURES: readonly Picture[] = [
  { emoji: "🍎", name: "apple" },
  { emoji: "🍌", name: "banana" },
  { emoji: "🍒", name: "cherries" },
  { emoji: "🍇", name: "grapes" },
  { emoji: "🍋", name: "lemon" },
  { emoji: "🍕", name: "pizza" },
  { emoji: "🐶", name: "dog" },
  { emoji: "🐱", name: "cat" },
  { emoji: "🐟", name: "fish" },
  { emoji: "🐸", name: "frog" },
  { emoji: "🐝", name: "bee" },
  { emoji: "🌳", name: "tree" },
  { emoji: "☀️", name: "sun" },
  { emoji: "🌙", name: "moon" },
  { emoji: "⭐", name: "star" },
  { emoji: "🔥", name: "fire" },
  { emoji: "🚗", name: "car" },
  { emoji: "✈️", name: "plane" },
  { emoji: "🔑", name: "key" },
  { emoji: "🔔", name: "bell" },
  { emoji: "❤️", name: "heart" },
  { emoji: "🎁", name: "gift" },
  { emoji: "💣", name: "bomb" },
  { emoji: "👑", name: "crown" },
];

const CATEGORIES: readonly (readonly string[])[] = [
  ["🍎", "🍌", "🍒", "🍇", "🍋", "🍉", "🍓"],
  ["🐶", "🐱", "🐸", "🐝", "🐮", "🐷", "🐔"],
  ["🚗", "✈️", "🚲", "🚀", "🚂", "⛵", "🚌"],
  ["☀️", "🌙", "⭐", "🌈", "⚡", "☁️", "❄️"],
  ["⚽", "🏀", "🎾", "🏈", "🎳", "🏓", "🎱"],
];

/** Each set is in order from the smallest to the biggest. */
const SIZES: readonly (readonly string[])[] = [
  ["🐜", "🐇", "🐕", "🐎", "🐘"],
  ["🍒", "🍎", "🍍", "🍉"],
  ["🌱", "🌿", "🌳"],
  ["🔑", "📱", "💻", "📺"],
  ["🐛", "🐈", "🐄", "🐋"],
];

function picturesRound(pick: Pick): ButtonRound {
  const chosen = sample(PICTURES, 6, pick);
  const ids = tokens(chosen.length, pick);
  const choices = chosen.map((picture, i) => ({ token: ids[i]!, emoji: picture.emoji }));
  const target = pick(chosen.length);
  const picture = chosen[target]!;
  return { type: "pictures", choices, answer: ids[target]!, values: { symbol: `${picture.emoji} ${picture.name}` } };
}

function countRound(pick: Pick): ButtonRound {
  const picture = PICTURES[pick(PICTURES.length)]!;
  const total = 3 + pick(5);
  const low = Math.max(1, Math.min(total - pick(4), 6));
  const numbers = [low, low + 1, low + 2, low + 3];
  const ids = tokens(numbers.length, pick);
  const choices = numbers.map((number, i) => ({ token: ids[i]!, label: String(number) }));
  return {
    type: "count",
    choices,
    answer: ids[numbers.indexOf(total)]!,
    values: { row: Array.from({ length: total }, () => picture.emoji).join(" "), symbol: picture.emoji },
  };
}

function oddRound(pick: Pick): ButtonRound {
  const [common, different] = sample(PICTURES, 2, pick) as [Picture, Picture];
  const emojis = shuffle([common, common, common, common, common, different], pick);
  const ids = tokens(emojis.length, pick);
  const choices = emojis.map((picture, i) => ({ token: ids[i]!, emoji: picture.emoji }));
  return { type: "odd", choices, answer: ids[emojis.indexOf(different)]!, values: {} };
}

function belongRound(pick: Pick): ButtonRound {
  const [own, other] = sample(CATEGORIES, 2, pick) as [readonly string[], readonly string[]];
  const members = sample(own, 3, pick);
  const outsider = other[pick(other.length)]!;
  const emojis = shuffle([...members, outsider], pick);
  const ids = tokens(emojis.length, pick);
  const choices = emojis.map((emoji, i) => ({ token: ids[i]!, emoji }));
  return { type: "belong", choices, answer: ids[emojis.indexOf(outsider)]!, values: {} };
}

function orderRound(pick: Pick): OrderRound {
  const set = SIZES.filter((entry) => entry.length >= 3)[pick(SIZES.length)] ?? SIZES[0]!;
  const picked = sample(
    set.map((emoji, size) => ({ emoji, size })),
    3,
    pick,
  ).sort((a, b) => a.size - b.size);
  const ids = tokens(picked.length, pick);
  const inOrder = picked.map((entry, i) => ({ token: ids[i]!, emoji: entry.emoji }));
  return { type: "order", choices: shuffle(inOrder, pick), answer: inOrder.map((choice) => choice.token), values: {} };
}

const WORDS = [
  "planet", "bridge", "castle", "garden", "window", "forest", "silver", "orange", "button", "market",
  "pocket", "rocket", "winter", "summer", "spring", "island", "mirror", "ticket", "yellow", "turtle",
];

function typedRound(pick: Pick): TypedRound {
  const kind = pick(4);
  if (kind === 3) {
    const word = WORDS[pick(WORDS.length)]!;
    return { type: "typed", answer: [...word].reverse().join(""), values: { question: `Type the word **${word}** backwards.` } };
  }
  const a = 2 + pick(8);
  const b = 2 + pick(8);
  if (kind === 0) return { type: "typed", answer: String(a + b), values: { question: `What is ${a} + ${b}?` } };
  if (kind === 1) {
    const [big, small] = a >= b ? [a, b] : [b, a];
    return { type: "typed", answer: String(big - small), values: { question: `What is ${big} − ${small}?` } };
  }
  return { type: "typed", answer: String(a * b), values: { question: `What is ${a} × ${b}?` } };
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

const MAKERS: Record<RoundType, (pick: Pick) => Round> = {
  pictures: picturesRound,
  count: countRound,
  odd: oddRound,
  belong: belongRound,
  order: orderRound,
  typed: typedRound,
  block: blockRound,
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

export type Given = { kind: "token"; token: string } | { kind: "text"; text: string };

export type Judgement = "correct" | "wrong" | "more";

/**
 * Whether what a member gave settles the round. An order round takes one press
 * at a time and is only judged once all of them are in. `isAnswer` says
 * whether typed text matches, since only the question's answers are settings.
 */
export function judge(
  round: Round,
  pressed: readonly string[],
  given: Given,
  isAnswer: (round: TypedRound | QuestionRound, text: string) => boolean,
): Judgement {
  switch (round.type) {
    case "pictures":
    case "count":
    case "odd":
    case "belong":
      return given.kind === "token" && given.token === round.answer ? "correct" : "wrong";
    case "order": {
      if (given.kind !== "token" || !round.choices.some((choice) => choice.token === given.token)) return "wrong";
      const all = pressed.includes(given.token) ? pressed : [...pressed, given.token];
      if (all.length < round.answer.length) return "more";
      return all.every((token, i) => token === round.answer[i]) ? "correct" : "wrong";
    }
    case "typed":
    case "block":
    case "question":
      return given.kind === "text" && isAnswer(round, given.text) ? "correct" : "wrong";
  }
}
