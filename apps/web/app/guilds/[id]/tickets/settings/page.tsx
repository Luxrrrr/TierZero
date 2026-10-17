import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../../lib/guild-data";
import { areaModule } from "../../../../../lib/module-href";
import { toModuleView } from "../../../../../lib/module-view";
import { requireTicketViewer } from "../../../../../lib/tickets-access";
import { ticketPanels, ticketsContext } from "../../../../../lib/tickets-api";
import { BotOffline } from "../../../../../components/BotOffline";
import { TicketsSettings } from "../../../../../components/tickets/TicketsSettings";
import { loaded } from "../data";

export const metadata: Metadata = { title: "Settings · Tickets" };

/**
 * The Tickets feature's settings, hosted in the Tickets area. The layout
 * admits handlers as well, so this is where Manage Server is required.
 */
export default async function TicketSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, guilds, viewer] = await Promise.all([
      guildModules(id),
      botGuilds(),
      requireTicketViewer(id).catch(() => null),
    ]);
    const module = areaModule(modules, "tickets", undefined);
    if (!module) redirect(`/guilds/${id}`);

    const viewerId = viewer?.ok ? viewer.viewerId : null;
    const [context, panels] = await Promise.all([
      viewerId ? loaded(ticketsContext(id, viewerId)) : Promise.resolve(null),
      viewerId ? loaded(ticketPanels(id, viewerId)) : Promise.resolve(null),
    ]);

    return (
      <TicketsSettings
        guildId={id}
        serverName={guilds.find((guild) => guild.id === id)?.name ?? "your server"}
        module={toModuleView(module)}
        context={context?.ok ? context.value : null}
        panels={
          panels?.ok
            ? panels.value
            : { error: panels ? panels.message : "The bot did not say who you are in this server. Reload the page to try again." }
        }
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
