import { ROADMAP_STATUS_LABEL, type RoadmapItem, type RoadmapStatus } from "../lib/roadmap";

const ORDER: RoadmapStatus[] = ["in-progress", "planned", "considering"];

/**
 * What is coming. Each row starts with a small status mark, the way an issue tracker marks its items: an empty
 * ring for planned, a half-filled one for in progress, a dashed one for being considered. The mark is also named
 * for screen readers, so the status is never only a shape.
 */
export function RoadmapList({ items }: { items: RoadmapItem[] }) {
  if (items.length === 0) return <p className="roadmap-empty">Nothing is listed yet. Check back after the next release.</p>;
  const ordered = ORDER.flatMap((status) => items.filter((item) => item.status === status));
  return (
    <ul className="roadmap-list">
      {ordered.map((item) => (
        <li key={item.title}>
          <span className="roadmap-mark" data-status={item.status} role="img" aria-label={ROADMAP_STATUS_LABEL[item.status]} title={ROADMAP_STATUS_LABEL[item.status]} />
          <div className="roadmap-text">
            <p className="roadmap-title">{item.title}</p>
            {item.description ? <p className="roadmap-desc">{item.description}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
