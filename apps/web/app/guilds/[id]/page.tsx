import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../lib/authz";
import { ControlApiError, getGuildModules, listBotGuilds } from "../../../lib/control-api";
import { BotOffline } from "../../../components/BotOffline";
import { GuildDashboard } from "./GuildDashboard";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const botGuilds = await listBotGuilds();
    return { title: botGuilds.find((g) => g.id === id)?.name ?? "Server" };
  } catch {
    return { title: "Server" };
  }
}

export default async function GuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, botGuilds] = await Promise.all([getGuildModules(id), listBotGuilds()]);
    const guild = botGuilds.find((g) => g.id === id);

    return <GuildDashboard guildId={id} guildName={guild?.name ?? id} modules={modules} />;
  } catch (error) {
    // redirect() and forbidden() signal themselves by throwing, so anything
    // that is not a control API failure has to carry on up.
    if (error instanceof ControlApiError) return <BotOffline />;
    throw error;
  }
}
