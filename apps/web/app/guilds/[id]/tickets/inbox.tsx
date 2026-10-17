import { forbidden, redirect } from "next/navigation";
import { parseTicketListFilters, type TicketDetailDto, type TicketMessagesPage } from "@tier0/core";
import { ControlApiError } from "../../../../lib/control-api";
import { requireTicketViewer } from "../../../../lib/tickets-access";
import { ticketDetail, ticketMessages, ticketsContext, ticketsList } from "../../../../lib/tickets-api";
import { BotOffline } from "../../../../components/BotOffline";
import { InboxScreen, type Loaded } from "../../../../components/tickets/InboxScreen";
import { canManageGuild, canModerateGuild, loaded } from "./data";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The inbox, with or without a ticket open beside it. Both routes render
 * through here, so the list keeps its filters while tickets are opened from
 * it and a link to one ticket still shows the list on a wide screen.
 */
export async function Inbox({ guildId, searchParams, ticketId }: { guildId: string; searchParams: SearchParams; ticketId?: number }) {
  let viewer;
  try {
    viewer = await requireTicketViewer(guildId);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
  const canManage = await canManageGuild(guildId);
  if (!viewer.ok) {
    if (viewer.status === 401) redirect("/login");
    if (canManage) redirect(`/guilds/${guildId}/tickets/settings`);
    forbidden();
  }

  const filters = parseTicketListFilters(searchParams);
  const selected: Promise<Loaded<{ ticket: TicketDetailDto; messages: TicketMessagesPage }>> | null =
    ticketId === undefined
      ? null
      : loaded(
          Promise.all([ticketDetail(guildId, viewer.viewerId, ticketId), ticketMessages(guildId, viewer.viewerId, ticketId)]).then(
            ([ticket, messages]) => ({ ticket, messages }),
          ),
        );

  const [context, list, open, canModerate] = await Promise.all([
    loaded(ticketsContext(guildId, viewer.viewerId)),
    loaded(ticketsList(guildId, viewer.viewerId, filters)),
    selected,
    canModerateGuild(guildId),
  ]);

  return (
    <InboxScreen
      guildId={guildId}
      viewerId={viewer.viewerId}
      filters={filters}
      context={context}
      list={list}
      selected={open && ticketId !== undefined ? { ...open, id: ticketId } : undefined}
      canManage={canManage}
      canModerate={canModerate}
    />
  );
}
