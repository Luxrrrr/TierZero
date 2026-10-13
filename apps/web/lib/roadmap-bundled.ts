import bundled from "../data/roadmap.json";
import { parseRoadmap, type RoadmapItem } from "./roadmap";

/** The roadmap that ships with this version, used when the live one cannot be fetched or checks are off. */
export const BUNDLED_ROADMAP: RoadmapItem[] = parseRoadmap(bundled);
