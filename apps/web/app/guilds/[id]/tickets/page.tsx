import type { Metadata } from "next";
import { Inbox } from "./inbox";

export const metadata: Metadata = { title: "Inbox · Tickets" };

export default async function TicketInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return <Inbox guildId={id} searchParams={await searchParams} />;
}
