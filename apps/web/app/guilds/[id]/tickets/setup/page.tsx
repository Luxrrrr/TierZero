import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../../lib/guild-data";
import { areaModule } from "../../../../../lib/module-href";
import { BotOffline } from "../../../../../components/BotOffline";
import { TicketsSetup } from "../../../../../components/tickets/TicketsSetup";

export const metadata: Metadata = { title: "Tickets setup" };

/**
 * The quick setup for Tickets. It is its own page rather than the generic
 * schema-driven one because it has a job the generic one cannot do: it ends
 * with the panel posted, and says what is still wrong if something is.
 */
export default async function TicketsSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const module = areaModule(modules, "tickets", undefined);
    if (!module) redirect(`/guilds/${id}`);

    return (
      <TicketsSetup
        guildId={id}
        serverName={guilds.find((guild) => guild.id === id)?.name ?? "your server"}
        settings={module.settings}
        enabled={module.enabled}
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
