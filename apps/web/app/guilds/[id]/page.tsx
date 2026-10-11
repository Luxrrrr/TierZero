import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../lib/authz";
import { ControlApiError } from "../../../lib/control-api";
import { botGuilds, guildModules } from "../../../lib/guild-data";
import { toModuleViews } from "../../../lib/module-view";
import { BotOffline } from "../../../components/BotOffline";
import { ModuleGrid } from "../../../components/ModuleGrid";
import { InfoIcon, SetupIcon } from "../../../components/Icons";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const guilds = await botGuilds();
    return { title: guilds.find((guild) => guild.id === id)?.name ?? "Server" };
  } catch {
    return { title: "Server" };
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export default async function GuildOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [rawModules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const modules = toModuleViews(rawModules);
    const guild = guilds.find((entry) => entry.id === id);

    const enabledCount = modules.filter((module) => module.enabled).length;
    const commands = modules.flatMap((module) => module.commands);
    const hidden = commands.filter((command) => !command.enabled).length;
    const restricted = commands.filter(
      (command) => command.allowRoles.length > 0 || command.denyChannels.length > 0,
    ).length;

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Server</p>
            <h1 className="page-title">{guild?.name ?? "Server"}</h1>
            <p className="page-summary">
              Everything TierZero can do here. Switching a feature on or off
              takes effect right away.
            </p>
          </div>
          <div className="page-actions">
            <Link className="btn btn-secondary btn-sm" href={`/guilds/${id}/setup`}>
              <SetupIcon />
              Quick setup
            </Link>
          </div>
        </div>

        {enabledCount === 0 ? (
          <div className="page-callouts">
            <div className="callout callout-info">
              <InfoIcon />
              <div>
                Nothing is switched on yet. If you are not sure what any of
                this does, <Link href={`/guilds/${id}/setup`}>quick setup</Link>{" "}
                asks a few questions per feature and turns them on for you.
                Most servers start with moderation and welcome messages.
              </div>
            </div>
          </div>
        ) : null}

        <div className="overview-stats">
          <div className="stat">
            <div className="stat-value">{(guild?.memberCount ?? 0).toLocaleString()}</div>
            <div className="stat-label">Members</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {enabledCount} of {modules.length}
            </div>
            <div className="stat-label">Features on</div>
          </div>
          <div className="stat">
            <div className="stat-value">{commands.length - hidden}</div>
            <div className="stat-label">Commands in Discord</div>
          </div>
        </div>

        <ModuleGrid guildId={id} modules={modules} />

        <div className="section-title">
          <h2>Commands</h2>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="card-header-text">
              <div className="card-title">Every command on this server</div>
              <p className="card-help">
                {plural(commands.length, "command")} · {hidden} hidden · {restricted} restricted
              </p>
            </div>
            <div className="card-header-actions">
              <Link className="btn btn-secondary btn-sm" href={`/guilds/${id}/commands`}>
                Manage commands
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
