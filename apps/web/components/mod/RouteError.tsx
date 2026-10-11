"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon, RefreshIcon } from "../Icons";
import { EmptyState } from "./ModUi";
import { describeLoadError } from "./format";

// In production Next.js replaces a server error's message with a digest, so
// the wording is the only clue left in development and none in production.
// The fallback copy therefore names the likeliest cause without asserting it.
function statusFromMessage(message: string): number | undefined {
  if (/could not reach the bot|bot could not be reached|fetch failed|ECONNREFUSED/iu.test(message)) return 503;
  if (/took too long/iu.test(message)) return 504;
  return undefined;
}

/**
 * The error boundary body for every mod route. "Try again" re-runs the
 * server render as well as the boundary, because the usual cause is the bot
 * having been unreachable for a moment.
 */
export function RouteError({ error, reset, what }: { error: Error & { digest?: string }; reset(): void; what: string }) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const status = statusFromMessage(error.message ?? "");
  const copy =
    status !== undefined
      ? describeLoadError(status, what)
      : {
          title: `Could not load ${what}`,
          text: "Something went wrong while preparing this page. This usually means the bot was briefly unreachable. Try again; if it keeps happening, check the bot's logs.",
          tone: "danger" as const,
        };

  return (
    <div className="mod-card">
      <EmptyState
        icon={<AlertIcon />}
        title={copy.title}
        tone={copy.tone}
        role="alert"
        action={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            <RefreshIcon />
            Try again
          </button>
        }
      >
        {copy.text}
        {error.digest ? (
          <>
            {" "}
            <span className="mod-id">Reference {error.digest}</span>
          </>
        ) : null}
      </EmptyState>
    </div>
  );
}
