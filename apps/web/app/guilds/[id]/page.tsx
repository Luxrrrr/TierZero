import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../lib/authz";
import { ControlApiError, getGuildModules, listBotGuilds } from "../../../lib/control-api";
import { BotOffline } from "../../../components/BotOffline";
import { fallbackSectionId, groupModulesBySection } from "../../../lib/sections";

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

/**
 * A guild has no dashboard content of its own anymore; every setting lives
 * on a section page. This sends the operator to whichever section actually
 * has something configurable, so landing on a guild never shows an empty
 * page just because the first section alphabetically happens to be unused.
 */
export default async function GuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const modules = await getGuildModules(id);
    const target = fallbackSectionId(groupModulesBySection(modules));
    redirect(`/guilds/${id}/${target}`);
  } catch (error) {
    // redirect() and forbidden() signal themselves by throwing, so anything
    // that is not a control API failure has to carry on up.
    if (error instanceof ControlApiError) return <BotOffline />;
    throw error;
  }
}
