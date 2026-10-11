"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SearchIcon, UserIcon } from "../Icons";
import { EmptyState } from "./ModUi";

/**
 * Shown when a mod page calls notFound(). A not-found file receives no
 * params, so the guild id comes from the URL to build the way back.
 */
export function RouteNotFound({ kind }: { kind: "member" | "page" }) {
  const params = useParams<{ id?: string }>();
  const base = params?.id ? `/guilds/${params.id}/mod` : "/guilds";

  if (kind === "member") {
    return (
      <div className="mod-card">
        <EmptyState
          icon={<UserIcon />}
          title="No record of this member"
          action={
            <Link className="btn btn-secondary btn-sm" href={`${base}/members`}>
              <SearchIcon />
              Browse members
            </Link>
          }
        >
          The link may be mistyped, or this account no longer exists on Discord and has nothing on its record.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mod-card">
      <EmptyState
        icon={<SearchIcon />}
        title="Nothing here"
        action={
          <Link className="btn btn-secondary btn-sm" href={base}>
            Back to the overview
          </Link>
        }
      >
        This page does not exist, or what it showed has been removed.
      </EmptyState>
    </div>
  );
}
