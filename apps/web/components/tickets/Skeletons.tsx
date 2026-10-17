import type { CSSProperties } from "react";

/**
 * Placeholders shaped like the ticket pages while their data is on its way,
 * so nothing jumps when it arrives.
 */

function Bar({ width, height = "0.75rem", style }: { width: string; height?: string; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width, height, display: "block", ...style }} />;
}

function Row() {
  return (
    <div className="tk-skel-row">
      <Bar width="30%" height="0.625rem" />
      <Bar width="85%" />
      <Bar width="55%" height="0.625rem" />
    </div>
  );
}

export function InboxSkeleton({ withTicket = false }: { withTicket?: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{withTicket ? "Loading the ticket" : "Loading the inbox"}</span>
      <div className="tk-inbox" data-has-ticket={withTicket ? "true" : undefined} aria-hidden="true">
        <div className="tk-inbox-list mod-card">
          <div className="tk-filters">
            <Bar width="100%" height="var(--control-height)" style={{ borderRadius: "var(--radius-md)" }} />
            <Bar width="70%" height="1.875rem" style={{ borderRadius: "var(--radius-md)" }} />
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <Row key={index} />
          ))}
        </div>
        <div className="tk-inbox-ticket">
          <div className="mod-card tk-skel-ticket">
            <Bar width="40%" height="0.75rem" />
            <Bar width="65%" height="1.25rem" />
            <Bar width="50%" height="0.625rem" />
            <div className="tk-skel-messages">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="tk-skel-message">
                  <Bar width="2.5rem" height="2.5rem" style={{ borderRadius: "999px", flex: "none" }} />
                  <div style={{ flex: 1, display: "grid", gap: "0.4rem" }}>
                    <Bar width="25%" height="0.625rem" />
                    <Bar width={index % 2 ? "70%" : "90%"} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
