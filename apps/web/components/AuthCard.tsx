import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** The single-character wordmark, or an icon element for an alert card. */
  mark: ReactNode;
  alert?: boolean;
  /** Hidden on the login page itself, where the card already carries the name. */
  brand?: boolean;
}

/**
 * The frame for every page shown before the dashboard: sign in, first-run
 * setup, and the two refusals. One card on a plain background, so a new
 * operator's first screen is as considered as the rest of the product.
 */
export function AuthCard({ children, mark, alert, brand = true }: Props) {
  return (
    <main className="auth">
      {brand ? (
        <Link href="/" className="auth-brand">
          <span className="mark" aria-hidden="true">
            0
          </span>
          TierZero
        </Link>
      ) : null}
      <div className={alert ? "auth-card is-alert" : "auth-card"}>
        <div className="auth-mark" aria-hidden="true">
          {mark}
        </div>
        {children}
      </div>
    </main>
  );
}
