import { diffSnapshots, isProse, showValue, wordDiff, type DiffRow } from "./diff";

/**
 * Before and after for one audit entry. Changed fields come first and are
 * marked with words as well as colour; fields that did not change are folded
 * away. Free text is compared word by word so an edited note reads as an
 * edit, not as two unrelated blocks.
 */
export function SnapshotDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = diffSnapshots(before, after);

  if (rows.length === 0) {
    return <p className="audit-nosnap">No before or after values were recorded for this entry.</p>;
  }

  const comparable = before != null && after != null;

  if (!comparable) {
    const side = before != null ? "before" : "after";
    return (
      <div className="audit-snap">
        <p className="audit-snap-caption">
          {side === "before" ? "The record as it was before this happened" : "The record as it is after this happened"}
        </p>
        <dl className="audit-fields">
          {rows.map((row) => (
            <div className="audit-field" key={row.path}>
              <dt>{row.label}</dt>
              <dd>
                <Value value={side === "before" ? row.before : row.after} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const changed = rows.filter((row) => row.changed);
  const same = rows.filter((row) => !row.changed);

  return (
    <div className="audit-snap">
      <p className="audit-snap-caption">
        {changed.length === 0
          ? "Nothing differs between the two snapshots."
          : `${changed.length} ${changed.length === 1 ? "field" : "fields"} changed`}
      </p>

      {changed.length > 0 ? (
        <ul className="audit-changes">
          {changed.map((row) => (
            <li className="audit-change" key={row.path}>
              <span className="audit-change-label">{row.label}</span>
              {isProse(row) ? <ProseDiff row={row} /> : <Beside row={row} />}
            </li>
          ))}
        </ul>
      ) : null}

      {same.length > 0 ? (
        <details className="audit-unchanged">
          <summary>
            {same.length} unchanged {same.length === 1 ? "field" : "fields"}
          </summary>
          <dl className="audit-fields">
            {same.map((row) => (
              <div className="audit-field" key={row.path}>
                <dt>{row.label}</dt>
                <dd>
                  <Value value={row.after} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Value({ value }: { value: unknown }) {
  const shown = showValue(value);
  return (
    <span className="audit-value" data-kind={shown.kind}>
      {shown.text}
    </span>
  );
}

function Beside({ row }: { row: DiffRow }) {
  return (
    <div className="audit-beside">
      <div className="audit-side audit-before">
        <span className="audit-side-tag">Before</span>
        {row.hasBefore ? <Value value={row.before} /> : <span className="audit-value" data-kind="none">Not set</span>}
      </div>
      <div className="audit-side audit-after">
        <span className="audit-side-tag">After</span>
        {row.hasAfter ? <Value value={row.after} /> : <span className="audit-value" data-kind="none">Not set</span>}
      </div>
    </div>
  );
}

function ProseDiff({ row }: { row: DiffRow }) {
  const segments = wordDiff(String(row.before), String(row.after));
  return (
    <p className="audit-prose">
      {segments.map((segment, index) =>
        segment.kind === "add" ? (
          <ins key={index}>
            <span className="visually-hidden">[added: </span>
            {segment.text}
            <span className="visually-hidden">]</span>
          </ins>
        ) : segment.kind === "del" ? (
          <del key={index}>
            <span className="visually-hidden">[removed: </span>
            {segment.text}
            <span className="visually-hidden">]</span>
          </del>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
