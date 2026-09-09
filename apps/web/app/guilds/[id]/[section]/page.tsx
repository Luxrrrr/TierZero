import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError, getGuildModules, listBotGuilds } from "../../../../lib/control-api";
import { BotOffline } from "../../../../components/BotOffline";
import { SectionNav } from "../../../../components/SectionNav";
import { SECTIONS, fallbackSectionId, groupModulesBySection, isSectionId } from "../../../../lib/sections";
import { GuildDashboard } from "../GuildDashboard";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}): Promise<Metadata> {
  const { id, section } = await params;
  try {
    const botGuilds = await listBotGuilds();
    const guildName = botGuilds.find((g) => g.id === id)?.name ?? "Server";
    const heading = SECTIONS.find((s) => s.id === section)?.heading;
    return { title: heading ? `${heading} · ${guildName}` : guildName };
  } catch {
    return { title: "Server" };
  }
}

/**
 * One section of a guild's dashboard: the section nav, then that section's
 * heading and module cards. A section slug that isn't one of the six fixed
 * categories, or one that currently has no module registered under it,
 * sends the operator to a section that does. A dead page here would look
 * end or a 404 — see fallbackSectionId.
 */
export default async function GuildSectionPage({
  params,
}: {
  params: Promise<{ id: string; section: string }>;
}) {
  const { id, section } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, botGuilds] = await Promise.all([getGuildModules(id), listBotGuilds()]);
    const guild = botGuilds.find((g) => g.id === id);
    const groups = groupModulesBySection(modules);

    if (!isSectionId(section)) {
      redirect(`/guilds/${id}/${fallbackSectionId(groups)}`);
    }

    const current = groups.find((group) => group.id === section);
    if (!current) {
      redirect(`/guilds/${id}/${fallbackSectionId(groups)}`);
    }

    return (
      <>
        <div className="shell-main-header">
          <div>
            <p className="shell-crumb">Configuring</p>
            <h1>{guild?.name ?? id}</h1>
          </div>
        </div>

        <SectionNav guildId={id} sections={groups} current={section} />

        <GuildDashboard
          guildId={id}
          heading={current.heading}
          description={current.description}
          modules={current.modules}
        />
      </>
    );
  } catch (error) {
    if (error instanceof ControlApiError) return <BotOffline />;
    throw error;
  }
}
