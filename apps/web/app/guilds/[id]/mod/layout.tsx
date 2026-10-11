import type { ReactNode } from "react";
import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { guildAccess } from "../../../../lib/guild-access";
import { modTabsFor } from "../../../../lib/mod-tabs";
import { ControlApiError } from "../../../../lib/control-api";
import { botGuilds } from "../../../../lib/guild-data";
import { BotOffline } from "../../../../components/BotOffline";
import { ModTabs } from "../../../../components/mod/ModTabs";
import { MemberSearch } from "../../../../components/mod/MemberSearch";
import "../../../mod.css";

export const metadata: Metadata = {
  title: "Moderation",
};

/**
 * The frame every moderation page sits in. It admits listed staff and anyone
 * who can manage the server, and the tab list it draws comes from which of
 * those the caller is. It is not the gate for the pages below: each checks the
 * permission it needs, because staff must not reach Settings and a manager who
 * is not listed staff must not reach the staff pages.
 */
export default async function ModLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const access = await guildAccess(id);
  if (!access.ok) {
    if (access.error instanceof ControlApiError) return <BotOffline />;
    if (access.status === 401) redirect("/login");
    forbidden();
  }

  let serverName = "Server";
  try {
    serverName = (await botGuilds()).find((guild) => guild.id === id)?.name ?? serverName;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }

  return (
    <div className="mod-root">
      <header className="mod-header">
        <div className="page-header-text">
          <p className="page-eyebrow">{serverName}</p>
          <h1 className="page-title">Moderation</h1>
        </div>
        {access.staffRole ? (
          <div className="mod-header-actions">
            <MemberSearch guildId={id} />
          </div>
        ) : null}
      </header>
      <ModTabs tabs={modTabsFor(id, access.staffRole, access.manager)} />
      {children}
    </div>
  );
}
