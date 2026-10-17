"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState } from "../mod/ModUi";
import { InboxIcon, SearchIcon } from "../Icons";

/**
 * Shown when a ticket page calls notFound(). A not-found file receives no
 * params, so the guild id comes from the address to build the way back.
 */
export function TicketNotFound({ kind }: { kind: "ticket" | "transcript" | "page" }) {
  const params = useParams<{ id?: string }>();
  const base = params?.id ? `/guilds/${params.id}/tickets` : "/guilds";
  const back = kind === "transcript" ? `${base}/transcripts` : base;
  const title = kind === "ticket" ? "There is no such ticket" : kind === "transcript" ? "There is no such transcript" : "Nothing here";
  return (
    <div className="mod-card">
      <EmptyState
        icon={kind === "page" ? <SearchIcon /> : <InboxIcon />}
        title={title}
        action={
          <Link className="btn btn-secondary btn-sm" href={back}>
            {kind === "transcript" ? "All transcripts" : "Back to the inbox"}
          </Link>
        }
      >
        {kind === "page"
          ? "This page does not exist, or what it showed has been removed."
          : "The number may be mistyped, or the ticket belongs to another server."}
      </EmptyState>
    </div>
  );
}
