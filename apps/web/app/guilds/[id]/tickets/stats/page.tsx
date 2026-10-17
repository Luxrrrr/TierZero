import type { Metadata } from "next";
import { ControlApiError } from "../../../../../lib/control-api";
import { ticketStats } from "../../../../../lib/tickets-api";
import { parseStatsPeriod } from "../../../../../lib/ticket-stats";
import { BotOffline } from "../../../../../components/BotOffline";
import { TicketStatsScreen } from "../../../../../components/tickets/TicketStatsScreen";
import { loaded, ticketViewerOrExit } from "../data";
import "../../mod/stats.css";

export const metadata: Metadata = { title: "Stats · Tickets" };

export default async function TicketStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const { id } = await params;
  const days = parseStatsPeriod((await searchParams).days);
  let viewer;
  try {
    viewer = await ticketViewerOrExit(id);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
  const stats = await loaded(ticketStats(id, viewer.viewerId, days));
  return <TicketStatsScreen guildId={id} days={days} stats={stats} />;
}
