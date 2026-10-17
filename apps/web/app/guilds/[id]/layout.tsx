import type { ReactNode } from "react";
import { forbidden, redirect } from "next/navigation";
import { auth } from "../../../lib/auth";
import { accessibleGuilds, guildAccess, guildHome } from "../../../lib/guild-access";
import { ControlApiError } from "../../../lib/control-api";
import { botGuilds, guildModules } from "../../../lib/guild-data";
import { toModuleViews } from "../../../lib/module-view";
import { AppShell } from "../../../components/AppShell";
import { Sidebar } from "../../../components/Sidebar";
import { BotOffline } from "../../../components/BotOffline";
import { captureDashboardUrl } from "../../../lib/dashboard-url-sync";
import { signOutAction } from "../actions";
import { PreviewServerProvider } from "../../../components/messages/PreviewServer";
import { guildIconUrl } from "../../../lib/discord-cdn";

/**
 * The shell for one server. Managers get the full navigation, built from the
 * module list the page below reads too (both calls go through the
 * request-scoped cache). Staff and ticket handlers who cannot manage the
 * server get a navigation with only Moderation or Tickets, and their module
 * list is never fetched.
 *
 * This layout does not guard the settings pages: each one checks Manage Server
 * itself, since a layout does not rerun when only the page beneath it changes.
 */
export default async function GuildLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = { name: session?.user?.name, image: session?.user?.image };

  try {
    const access = await guildAccess(id);
    if (!access.ok) {
      if (access.error instanceof ControlApiError) throw access.error;
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    await captureDashboardUrl(session?.user?.id);

    // The switcher lists only servers this user can open, never every server
    // the bot is in.
    const [modules, allGuilds, accessible] = await Promise.all([
      access.manager ? guildModules(id) : Promise.resolve([]),
      botGuilds(),
      accessibleGuilds(session?.user?.id ?? ""),
    ]);
    const guilds = allGuilds.filter((entry) => accessible.all.has(entry.id));
    const guild = guilds.find((entry) => entry.id === id);

    return (
      <AppShell
        title={guild?.name ?? "Server"}
        sidebar={
          <Sidebar
            user={user}
            guilds={guilds}
            homes={Object.fromEntries(guilds.map((entry) => [entry.id, guildHome(entry.id, accessible)]))}
            currentGuild={guild}
            modules={toModuleViews(modules)}
            canManage={access.manager}
            canModerate={access.staffRole !== null}
            canHandleTickets={access.ticketLevel !== null}
            signOutAction={signOutAction}
          />
        }
      >
        <PreviewServerProvider
          server={guild ? { name: guild.name, memberCount: guild.memberCount, iconUrl: guildIconUrl(guild.id, guild.icon, 256) ?? "" } : null}
        >
          {children}
        </PreviewServerProvider>
      </AppShell>
    );
  } catch (error) {
    // redirect() and forbidden() signal themselves by throwing, so anything
    // that is not a control API failure has to carry on up.
    if (!(error instanceof ControlApiError)) throw error;
    // The bot is what knows the server's name and features, but the way around
    // the server is worth keeping while it is away; every page checks access again.
    const placeholder = { id, name: "This server", icon: null, memberCount: 0 };
    return (
      <AppShell
        title="Bot not running"
        sidebar={<Sidebar user={user} guilds={[placeholder]} currentGuild={placeholder} modules={[]} signOutAction={signOutAction} />}
      >
        <BotOffline />
      </AppShell>
    );
  }
}
