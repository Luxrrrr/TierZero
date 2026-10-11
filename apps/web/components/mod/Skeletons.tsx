import type { CSSProperties, ReactNode } from "react";

/**
 * Placeholders shaped like the mod pages, shown while a page's data is on
 * its way. Matching the real layout keeps the page from jumping when the
 * content arrives.
 */

function Bar({ width, height = "0.75rem", style }: { width: string; height?: string; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width, height, ...style }} />;
}

export function SkeletonFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mod-page" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonToolbar({ chips = 4 }: { chips?: number }) {
  return (
    <div className="mod-toolbar" aria-hidden="true">
      <Bar width="18rem" height="var(--control-height)" style={{ borderRadius: "var(--radius-md)", maxWidth: "100%" }} />
      {Array.from({ length: chips }, (_, index) => (
        <Bar key={index} width="5.5rem" height="2rem" style={{ borderRadius: "var(--radius-full)" }} />
      ))}
    </div>
  );
}

export function SkeletonKpis({ count = 4 }: { count?: number }) {
  return (
    <div className="mod-kpis" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="mod-kpi" key={index}>
          <Bar width="45%" />
          <Bar width="35%" height="1.75rem" style={{ marginTop: "0.25rem" }} />
          <Bar width="60%" height="0.625rem" style={{ marginTop: "0.25rem" }} />
        </div>
      ))}
    </div>
  );
}

const COLUMN_WIDTHS = ["9rem", "6rem", "14rem", "5rem", "7rem", "4rem"];

export function SkeletonTable({ rows = 8, columns = 5, title = true }: { rows?: number; columns?: number; title?: boolean }) {
  return (
    <div className="mod-card" aria-hidden="true">
      {title ? (
        <div className="mod-card-head">
          <Bar width="8rem" height="0.875rem" />
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, row) => (
        <div className="mod-skel-row" key={row}>
          <span className="skeleton mod-skel-circle" />
          {Array.from({ length: columns }, (_, column) => (
            <Bar
              key={column}
              width={COLUMN_WIDTHS[column % COLUMN_WIDTHS.length]!}
              style={{ opacity: 1 - row * 0.06, flex: column === 2 ? "1 1 auto" : "none", maxWidth: COLUMN_WIDTHS[column % COLUMN_WIDTHS.length] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = "14rem" }: { height?: string }) {
  return (
    <div className="mod-card" aria-hidden="true">
      <div className="mod-card-head">
        <Bar width="10rem" height="0.875rem" />
      </div>
      <div className="mod-card-body">
        <Bar width="100%" height={height} style={{ borderRadius: "var(--radius-md)" }} />
      </div>
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <>
      <div className="mod-card" aria-hidden="true">
        <div className="mod-card-body" style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
          <span className="skeleton" style={{ width: "4rem", height: "4rem", borderRadius: "var(--radius-full)", flex: "none" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: "1 1 auto" }}>
            <Bar width="12rem" height="1.25rem" />
            <Bar width="18rem" />
          </div>
          <Bar width="6rem" height="var(--control-height)" style={{ borderRadius: "var(--radius-md)" }} />
        </div>
      </div>
      <SkeletonKpis count={4} />
      <SkeletonTable rows={6} columns={3} />
    </>
  );
}
