"use client";

import { useEffect, useMemo, useState } from "react";
import { TRANSCRIPT_CSS, transcriptTree, type TicketMessageDto, type TranscriptActivity, type TranscriptLabels } from "@tier0/core";
import { renderTranscriptNode } from "../../lib/transcript-react";

/**
 * A ticket's messages drawn the way Discord draws them, from the same tree and
 * stylesheet as the downloaded transcript. Times are UTC until the page runs,
 * then the reader's own, so the server's markup and the first render agree.
 */
export function DiscordTranscript({
  messages,
  channelName,
  topic,
  activity,
  names,
  labels,
  thread = false,
}: {
  messages: readonly TicketMessageDto[];
  channelName: string;
  topic: string | null;
  /** Ticket events to show between the messages, or none. */
  activity?: readonly TranscriptActivity[];
  /** Names known besides the ones stored with each message. */
  names?: Record<string, string>;
  labels?: Partial<TranscriptLabels>;
  /** The ticket is a private thread, headed as one. */
  thread?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // "Today" and "Yesterday" move at midnight; a minute is close enough.
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const tree = useMemo(
    () =>
      transcriptTree({
        messages,
        channelName,
        topic,
        activity,
        labels,
        thread,
        clock: now ? { now } : { now: null, timeZone: "UTC" },
        names: names ? { users: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])) } : undefined,
      }),
    [messages, channelName, topic, activity, labels, now, names, thread],
  );

  return (
    <>
      {/* A constant from @tier0/core, not member input. */}
      <style dangerouslySetInnerHTML={{ __html: TRANSCRIPT_CSS }} />
      {renderTranscriptNode(tree)}
    </>
  );
}
