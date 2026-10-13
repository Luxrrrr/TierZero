export type RoadmapStatus = "in-progress" | "planned" | "considering";

export interface RoadmapItem {
  title: string;
  description: string;
  status: RoadmapStatus;
}

const STATUSES: RoadmapStatus[] = ["in-progress", "planned", "considering"];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  "in-progress": "In progress",
  planned: "Planned",
  considering: "Considering",
};

/** Reads a roadmap file, dropping any entry that is not a title with a status. Anything unreadable gives an empty list. */
export function parseRoadmap(input: unknown): RoadmapItem[] {
  const list = typeof input === "object" && input !== null ? (input as { items?: unknown }).items : null;
  if (!Array.isArray(list)) return [];
  const items: RoadmapItem[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { title, description, status } = entry as Record<string, unknown>;
    if (typeof title !== "string" || title.trim() === "" || typeof status !== "string" || !STATUSES.includes(status as RoadmapStatus)) continue;
    items.push({
      title: title.trim().slice(0, 100),
      description: typeof description === "string" ? description.trim().slice(0, 400) : "",
      status: status as RoadmapStatus,
    });
  }
  return items.slice(0, 40);
}
