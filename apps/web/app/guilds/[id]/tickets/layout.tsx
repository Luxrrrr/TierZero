import type { ReactNode } from "react";
import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import type { TicketAccessLevel, TicketContextDto } from "@tier0/core";
import { ControlApiError } from "../../../../lib/control-api";
import { botGuilds } from "../../../../lib/guild-data";
import { requireTicketViewer } from "../../../../lib/tickets-access";
import { ticketsContext } from "../../../../lib/tickets-api";
import { healthTabText } from "../../../../lib/ticket-health";
import { ticketTabsFor } from "../../../../lib/ticket-tabs";
import { BotOffline } from "../../../../components/BotOffline";
import { TicketTabs } from "../../../../components/tickets/TicketTabs";
import { canManageGuild } from "./data";
import { gateTicketsPage } from "../../../../lib/page-gate-apply";
import "../../../mod.css";
import "../mod/members/[userId]/profile.css";
import "./tickets.css";
import "./discord-transcript.css";

export const metadata: Metadata = {
  title: "Tickets",
};

/**
 * The frame every ticket page sits in. It admits anyone who works tickets
 * here and anyone who can manage the server, and draws the tabs that person
 * can open. It is not the gate for the pages below: each checks for itself,
 * because a handler must not reach Settings.
 */
export default async function TicketsLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;

  let level: TicketAccessLevel | null = null;
  let viewerId: string | null = null;
  let unauthenticated = false;
  try {
    const viewer = await requireTicketViewer(id);
    if (viewer.ok) {
      level = viewer.level;
      viewerId = viewer.viewerId;
    } else unauthenticated = viewer.status === 401;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
  if (unauthenticated) redirect("/login");

  const canManage = await canManageGuild(id);
  if (level === null && !canManage) forbidden();
  // The pages below check again; this is what gives a refusal its 403 despite the loading screen.
  await gateTicketsPage(id, level, canManage);

  let serverName = "Server";
  let context: TicketContextDto | null;
  try {
    const [guilds, read] = await Promise.all([
      botGuilds(),
      // Only for the dot on the Settings tab, so a failure just leaves it off.
      canManage && viewerId ? ticketsContext(id, viewerId).catch(() => null) : Promise.resolve(null),
    ]);
    serverName = guilds.find((guild) => guild.id === id)?.name ?? serverName;
    context = read;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }

  // Counted the way the Settings tab's own card counts, so the mark and the card agree.
  const flag = context ? (healthTabText(context) ?? undefined) : undefined;

  return (
    <div className="mod-root tk-root">
      <header className="mod-header tk-header">
        <div className="page-header-text">
          <p className="page-eyebrow">{serverName}</p>
          <h1 className="page-title">Tickets</h1>
        </div>
      </header>
      <TicketTabs tabs={ticketTabsFor(id, level, canManage)} flags={flag ? { settings: flag } : {}} />
      {children}
    </div>
  );
}
