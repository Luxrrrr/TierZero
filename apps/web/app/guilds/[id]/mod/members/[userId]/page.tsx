import Link from "next/link";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { MemberProfile } from "@tier0/core";
import { ControlApiError } from "../../../../../../lib/control-api";
import { requireGuildAccess } from "../../../../../../lib/authz";
import { requireStaff } from "../../../../../../lib/mod-access";
import { modProfile } from "../../../../../../lib/mod-api";
import { redactProfile } from "../../../../../../lib/profile-redact";
import { AlertIcon, UserIcon } from "../../../../../../components/Icons";
import { displayName } from "../../../../../../components/mod/ModUi";
import { ProfileView, RetryButton } from "./ProfileView";
import { parseCaseParam } from "./timeline";
import "../../../../../mod.css";
import "./profile.css";

// Shared by the title and the page, so one request serves both.
const load = cache(loadProfile);

/**
 * The member's name as the tab title, so a reader with several records open
 * can tell them apart. The same staff check as the page runs first; anyone
 * else gets the generic title.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; userId: string }>;
}): Promise<Metadata> {
  const { id, userId } = await params;
  const access = await requireStaff(id);
  if (!access.ok) return { title: "Member record" };
  const result = await load(id, userId);
  return { title: "profile" in result ? `${displayName(result.profile.user)} · Member record` : "Member record" };
}

async function loadProfile(guildId: string, userId: string): Promise<{ profile: MemberProfile } | { error: string; status: number }> {
  try {
    return { profile: await modProfile(guildId, userId) };
  } catch (error) {
    if (error instanceof ControlApiError) return { error: error.message, status: error.status };
    return { error: "The bot could not be reached. Check that it is running, then try again.", status: 502 };
  }
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; userId: string }>;
  searchParams: Promise<{ case?: string | string[] }>;
}) {
  const { id, userId } = await params;
  const focusCase = parseCaseParam((await searchParams).case);

  const access = await requireStaff(id);
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }

  const result = await load(id, userId);

  if ("error" in result) {
    const missing = result.status === 404;
    return (
      <div className="mod-root pf">
        <nav className="pf-crumbs" aria-label="Breadcrumb">
          <Link href={`/guilds/${id}/mod/members`}>Members</Link>
        </nav>
        <div className="mod-card">
          <div className="mod-empty" data-tone={missing ? undefined : "attention"} role={missing ? undefined : "alert"}>
            <span className="mod-empty-icon">{missing ? <UserIcon /> : <AlertIcon />}</span>
            <p className="mod-empty-title">{missing ? "No record for this member" : "The record could not be loaded"}</p>
            <p className="mod-empty-text">{result.error}</p>
            <div className="mod-empty-action">
              <Link className="btn btn-secondary btn-sm" href={`/guilds/${id}/mod/members`}>
                Back to members
              </Link>
              {missing ? null : <RetryButton />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Only decides whether to offer a link to the settings; a lookup that fails
  // just leaves the link out, and the settings page checks again itself.
  const canConfigure = await requireGuildAccess(id).then(
    (result) => result.ok,
    () => false,
  );

  return (
    <ProfileView
      guildId={id}
      profile={redactProfile(result.profile, access.role)}
      role={access.role}
      renderedAt={new Date().toISOString()}
      viewerId={access.discordUserId}
      viewerName={access.name}
      canConfigure={canConfigure}
      focusCase={focusCase}
    />
  );
}
