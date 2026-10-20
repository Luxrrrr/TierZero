import type { Metadata } from "next";
import { parseTicketListFilters } from "@tier0/shared-tickets";
import { ControlApiError } from "../../../../../lib/control-api";
import { ticketsContext, ticketsList } from "../../../../../lib/tickets-api";
import { BotOffline } from "../../../../../components/BotOffline";
import { TranscriptsScreen } from "../../../../../components/tickets/TranscriptsScreen";
import { loaded, ticketViewerOrExit } from "../data";

export const metadata: Metadata = { title: "Transcripts · Tickets" };

export default async function TranscriptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  let viewer;
  try {
    viewer = await ticketViewerOrExit(id);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
  // The archive is closed tickets only, whatever an old link says.
  const filters = { ...parseTicketListFilters(await searchParams), status: "closed" as const };
  const [context, list] = await Promise.all([
    loaded(ticketsContext(id, viewer.viewerId)),
    loaded(ticketsList(id, viewer.viewerId, filters)),
  ]);
  return <TranscriptsScreen guildId={id} filters={filters} context={context} list={list} />;
}
