import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../lib/guild-data";
import { BotOffline } from "../../../../components/BotOffline";
import { CommandsBrowser } from "../../../../components/CommandsBrowser";
import { CommandsIcon } from "../../../../components/Icons";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const guilds = await botGuilds();
    const name = guilds.find((guild) => guild.id === id)?.name;
    return { title: name ? `Commands · ${name}` : "Commands" };
  } catch {
    return { title: "Commands" };
  }
}

export default async function CommandsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const modules = await guildModules(id);
    const groups = modules
      .filter((module) => module.commands.length > 0)
      .map((module) => ({
        id: module.id,
        name: module.name,
        summary: module.summary,
        commands: module.commands,
      }));

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Server</p>
            <h1 className="page-title">Commands</h1>
            <p className="page-summary">
              Turn a command off to remove it from Discord on this server, or
              limit who can use it and where.
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="empty">
            <CommandsIcon className="empty-icon" />
            <p className="empty-title">No commands are installed</p>
            <p className="empty-text">
              Commands come from features. This install has no feature that
              provides one, which usually means a module package is missing.
            </p>
          </div>
        ) : (
          <CommandsBrowser guildId={id} groups={groups} />
        )}
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
