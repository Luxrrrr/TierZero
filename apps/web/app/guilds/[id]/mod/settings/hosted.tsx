import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../../lib/guild-data";
import { areaModule, areaModules, moduleHref } from "../../../../../lib/module-href";
import { toModuleView } from "../../../../../lib/module-view";
import { BotOffline } from "../../../../../components/BotOffline";
import { ModSettingsSwitch } from "../../../../../components/ModSettingsSwitch";
import { ModulePage } from "../../../../../components/ModulePage";

/** The tab title names the module, since the page itself has no h1 for it. */
export async function hostedMetadata(guildId: string, moduleId?: string): Promise<Metadata> {
  try {
    const [modules, guilds] = await Promise.all([guildModules(guildId), botGuilds()]);
    const name = areaModule(modules, "moderation", moduleId)?.name;
    const guildName = guilds.find((guild) => guild.id === guildId)?.name;
    const title = name ? `${name} settings` : "Moderation settings";
    return { title: guildName ? `${title} · ${guildName}` : title };
  } catch {
    return { title: "Moderation settings" };
  }
}

/**
 * The settings of one module hosted in the Moderation area. Both routes render
 * through here so the access rule and the form are written once.
 *
 * The layout above admits staff and managers alike, so this is where Manage
 * Server is actually required: a staff role does not grant it.
 */
export async function HostedSettings({ guildId, moduleId }: { guildId: string; moduleId?: string }) {
  try {
    const access = await requireGuildAccess(guildId);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, guilds] = await Promise.all([guildModules(guildId), botGuilds()]);
    const hosted = areaModules(modules, "moderation");
    const first = hosted[0];
    if (!first) redirect(`/guilds/${guildId}`);

    const module = areaModule(modules, "moderation", moduleId);
    // An id the area does not host is a stale link, not a missing page.
    if (!module) redirect(moduleHref(guildId, first));
    // The first module has one address, the root; the deeper one is a duplicate.
    if (moduleId !== undefined && module.id === first.id) redirect(moduleHref(guildId, first));

    const views = hosted.map(toModuleView);
    const view = views.find((entry) => entry.id === module.id) ?? toModuleView(module);

    return (
      <>
        {views.length > 1 ? (
          <ModSettingsSwitch
            items={views.map((entry) => ({
              id: entry.id,
              name: entry.name,
              href: moduleHref(guildId, entry),
              status: entry.status,
            }))}
          />
        ) : null}
        <ModulePage
          key={view.id}
          embedded
          guildId={guildId}
          serverName={guilds.find((guild) => guild.id === guildId)?.name ?? "your server"}
          eyebrow="Moderation"
          module={view}
        />
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
