"use client";

import { useRouter } from "next/navigation";
import { AlertIcon } from "./Icons";

/**
 * Shown in place of a page's content when the dashboard cannot reach the
 * bot's control API. The bot owns every setting, so there is nothing useful
 * to render without it, and the reader needs to know which of the two
 * processes to go and look at.
 */
export function BotOffline() {
  const router = useRouter();

  return (
    <div className="empty">
      <AlertIcon className="empty-icon" />
      <p className="empty-title">The bot is not responding</p>
      <p className="empty-text">
        The dashboard talks to the bot over its control API, and that connection
        was refused. Either the bot is not running, or it is listening somewhere
        other than the address the dashboard is configured with.
      </p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={() => router.refresh()}>
          Try again
        </button>
      </div>
    </div>
  );
}
