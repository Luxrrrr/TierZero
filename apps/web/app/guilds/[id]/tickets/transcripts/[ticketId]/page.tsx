import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseTicketListFilters } from "@tier0/shared-tickets";
import { ControlApiError } from "../../../../../../lib/control-api";
import { ticketDetail, ticketMessages, ticketsContext } from "../../../../../../lib/tickets-api";
import { ticketIdFrom } from "../../../../../../lib/ticket-format";
import { BotOffline } from "../../../../../../components/BotOffline";
import { TranscriptScreen } from "../../../../../../components/tickets/TranscriptScreen";
import { canModerateGuild, loaded, ticketViewerOrExit } from "../../data";

export async function generateMetadata({ params }: { params: Promise<{ ticketId: string }> }): Promise<Metadata> {
  const { ticketId } = await params;
  const id = ticketIdFrom(ticketId);
  return { title: id ? `Transcript #${id} · Tickets` : "Transcripts" };
}

export default async function TranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ticketId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, ticketId } = await params;
  const number = ticketIdFrom(ticketId);
  if (number === null) notFound();

  let viewer;
  try {
    viewer = await ticketViewerOrExit(id);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }

  const filters = { ...parseTicketListFilters(await searchParams), status: "closed" as const };
  const [context, ticket, messages, canModerate] = await Promise.all([
    loaded(ticketsContext(id, viewer.viewerId)),
    loaded(ticketDetail(id, viewer.viewerId, number)),
    loaded(ticketMessages(id, viewer.viewerId, number)),
    canModerateGuild(id),
  ]);
  if (!ticket.ok && ticket.status === 404) notFound();

  return (
    <TranscriptScreen
      guildId={id}
      viewerId={viewer.viewerId}
      filters={filters}
      context={context}
      ticket={ticket}
      messages={messages}
      canModerate={canModerate}
    />
  );
}
