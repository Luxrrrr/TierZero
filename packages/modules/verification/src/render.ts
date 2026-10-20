import { renderStill } from "./image.js";
import { renderMotion } from "./motion.js";
import type { ImageRound, TilesRound } from "./rounds.js";
import { renderTiles } from "./tiles.js";

/** The picture for a round and the file name it is sent under. */
export function renderRound(round: ImageRound | TilesRound): [Buffer, { name: string }] {
  if (round.type === "tiles") return [renderTiles(round.tiles), { name: "captcha.png" }];
  return round.type === "motion" ? [renderMotion(round.image), { name: "captcha.gif" }] : [renderStill(round.image), { name: "captcha.png" }];
}
