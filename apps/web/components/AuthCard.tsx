import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** The single-letter mark, or an icon element for an alert-style card. */
  mark: ReactNode;
  alert?: boolean;
}

/**
 * The shared frame for every pre-dashboard page: login, setup, forbidden,
 * bot-offline. These are what a new operator sees before anything else
 * works, so they get the same considered layout as the dashboard itself
 * so it does not read as bare text floating on the page background.
 */
export function AuthCard({ children, mark, alert }: Props) {
  return (
    <main className="auth-main">
      <div className={alert ? "auth-card is-alert" : "auth-card"}>
        <div className="mark">{mark}</div>
        {children}
      </div>
    </main>
  );
}
