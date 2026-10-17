import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ticketIdFrom } from "../../../../../lib/ticket-format";
import { Inbox } from "../inbox";

export async function generateMetadata({ params }: { params: Promise<{ ticketId: string }> }): Promise<Metadata> {
  const { ticketId } = await params;
  const id = ticketIdFrom(ticketId);
  return { title: id ? `Ticket #${id} · Tickets` : "Tickets" };
}

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ticketId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, ticketId } = await params;
  const number = ticketIdFrom(ticketId);
  if (number === null) notFound();
  return <Inbox guildId={id} searchParams={await searchParams} ticketId={number} />;
}
