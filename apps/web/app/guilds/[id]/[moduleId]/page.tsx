import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../lib/guild-data";
import { isHosted, moduleHref } from "../../../../lib/module-href";
import { toModuleView } from "../../../../lib/module-view";
import { SECTIONS } from "../../../../lib/sections";
import { BotOffline } from "../../../../components/BotOffline";
import { ModulePage } from "../../../../components/ModulePage";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}): Promise<Metadata> {
  const { id, moduleId } = await params;
  try {
    const [modules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const name = modules.find((module) => module.id === moduleId)?.name;
    const guildName = guilds.find((guild) => guild.id === id)?.name;
    if (!name) return { title: guildName ?? "Server" };
    return { title: guildName ? `${name} · ${guildName}` : name };
  } catch {
    return { title: "Server" };
  }
}

/**
 * One feature's settings. Anything that is not a module registered on this
 * install lands here too (the dashboard's old section slugs among them) and
 * goes back to the overview rather than showing a dead page. A module hosted
 * inside an area of the dashboard is sent to its new address, so bookmarks to
 * the page it used to have keep working.
 */
export default async function ModuleSettingsPage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const module = modules.find((entry) => entry.id === moduleId);
    if (!module) redirect(`/guilds/${id}`);
    if (isHosted(module)) redirect(moduleHref(id, module));

    const guild = guilds.find((entry) => entry.id === id);
    const section = SECTIONS.find((entry) => entry.id === module.category);

    return (
      <ModulePage
        guildId={id}
        serverName={guild?.name ?? "your server"}
        eyebrow={section?.heading ?? "Feature"}
        module={toModuleView(module)}
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
