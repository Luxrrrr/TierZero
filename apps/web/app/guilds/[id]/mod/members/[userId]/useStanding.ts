"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionTargetDto } from "@tier0/core";
import { readStanding } from "./actions";

/**
 * What Discord says about the member right now, for the person viewing: banned
 * or not, timed out until when, and which actions the bot would refuse them.
 * Read once the page is up, and again after anything that can change it. Until
 * it arrives, or if it cannot be read, the page goes by the record.
 */
export function useStanding(guildId: string, userId: string): { standing: ActionTargetDto | null; reload(): void } {
  const [standing, setStanding] = useState<ActionTargetDto | null>(null);
  const request = useRef(0);

  const reload = useCallback(() => {
    const id = ++request.current;
    void (async () => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}/standing`, { cache: "no-store" });
        const data: unknown = res.ok ? await res.json().catch(() => null) : null;
        // An older answer arriving after a newer request would put back what that request replaced.
        if (id === request.current) setStanding(readStanding(data));
      } catch {
        if (id === request.current) setStanding(null);
      }
    })();
  }, [guildId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { standing, reload };
}
