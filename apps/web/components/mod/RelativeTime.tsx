"use client";

import { useEffect, useState } from "react";
import { fmtDateTimeUtc, fmtDateUtc, fmtLocal, timeAgo } from "./format";

/** The current time once mounted, refreshed every minute; null during the server render and hydration. */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * "3 hours ago", with the full local time on hover. The server render shows
 * the UTC date, which both sides agree on; the relative wording replaces it
 * once the page runs in the browser. See the note in format.ts.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow();
  return (
    <time
      className={className}
      dateTime={iso}
      title={now ? fmtLocal(iso, "datetime") : fmtDateTimeUtc(iso)}
      suppressHydrationWarning
    >
      {now ? timeAgo(iso, now) : fmtDateUtc(iso)}
    </time>
  );
}

/** An absolute date or date and time: UTC and labelled on the server, the reader's own after mount. */
export function LocalTime({
  iso,
  mode = "datetime",
  className,
}: {
  iso: string;
  mode?: "date" | "datetime";
  className?: string;
}) {
  const now = useNow();
  const text = now ? fmtLocal(iso, mode) : mode === "date" ? fmtDateUtc(iso) : fmtDateTimeUtc(iso);
  return (
    <time className={className} dateTime={iso} title={now ? fmtLocal(iso, "datetime") : fmtDateTimeUtc(iso)} suppressHydrationWarning>
      {text}
    </time>
  );
}
