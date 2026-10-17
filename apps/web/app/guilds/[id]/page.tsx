import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../lib/authz";
import { guildAccess } from "../../../lib/guild-access";
import { ControlApiError, getCommandSync, type CommandSyncStatus } from "../../../lib/control-api";
import { botGuilds, guildModules } from "../../../lib/guild-data";
import { toModuleViews } from "../../../lib/module-view";
import { commandCounts, liveCountShown } from "../../../lib/commands";
import { missingInvitePermissions, missingPermissions, permissionLabel } from "../../../lib/invite";
import { BotOffline } from "../../../components/BotOffline";
import { ModuleGrid } from "../../../components/ModuleGrid";
import { AlertIcon, InfoIcon, SetupIcon } from "../../../components/Icons";
import { redirectToLogin } from "../../../lib/auth-redirect";

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
      if (access.status === 401) await redirectToLogin();
      // Someone who may not configure the server may still work in it. A link
      // to the server, such as one a ticket notice carries, takes them there.
      const other = await guildAccess(id).catch(() => null);
      if (other?.ok && other.staffRole) redirect(`/guilds/${id}/mod`);
      if (other?.ok && other.ticketLevel) redirect(`/guilds/${id}/tickets`);
      forbidden();
    }

    const [rawModules, guilds, sync] = await Promise.all([
      guildModules(id),
      botGuilds(),
      // An older bot without this answer still gets a count, worked out from the settings.
      getCommandSync(id).catch((): CommandSyncStatus | null => null),
    ]);
    // The bot's own settings are not a feature to switch on, so they stay out of the counts and the grid.
    const modules = toModuleViews(rawModules.filter((module) => !module.alwaysOn));
    const guild = guilds.find((entry) => entry.id === id);

    const enabledCount = modules.filter((module) => module.enabled).length;
    // Built-in commands are in Discord too, so the count reads every module, not only the tiles.
    const counts = commandCounts(rawModules);
    const live = liveCountShown(counts.live, sync);
    const lacking = missingInvitePermissions(guild?.permissions) ?? [];
    const missing = Object.fromEntries(
      modules.map((module) => [module.id, missingPermissions(module.requires, guild?.permissions) ?? []]),
    );

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

        {sync?.failed ? (
          <div className="page-callouts">
            <div className="callout callout-error">
              <AlertIcon />
              <div>
                Discord did not accept this server&apos;s commands, so members cannot use
                them. This usually means the bot was added without permission to create
                commands. Add it again with the invite link on{" "}
                <Link href="/guilds">Your servers</Link>; its settings are kept.
              </div>
            </div>
          </div>
        ) : null}

        {lacking.length > 0 ? (
          <div className="page-callouts">
            <div className="callout callout-attention">
              <AlertIcon />
              <div>
                The bot is missing {lacking.length === 1 ? "a permission" : "permissions"} it asks for when it is
                invited: {lacking.map(permissionLabel).join(", ")}. Features that need{" "}
                {lacking.length === 1 ? "it" : "them"} say so on their tile. Give the bot&apos;s role{" "}
                {lacking.length === 1 ? "it" : "them"} under Server Settings, Roles, or add the bot again with the
                invite link on <Link href="/guilds">Your servers</Link>. Its settings are kept.
              </div>
            </div>
          </div>
        ) : null}

        {enabledCount === 0 ? (
          <div className="page-callouts">
            <div className="callout callout-info">
              <InfoIcon />
              <div>
                Nothing is switched on yet. If you are not sure what any of
                this does, <Link href={`/guilds/${id}/setup`}>quick setup</Link>{" "}
                asks a few questions per feature and turns them on for you.
                Most servers start with moderation and welcome messages. The
                bot can only give out roles that sit below its own role, so
                drag its role up the list under Server Settings, Roles, above
                any role it should hand out.
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
            <div className="stat-value">{live}</div>
            <div className="stat-label">Commands in Discord</div>
          </div>
        </div>

        <ModuleGrid guildId={id} modules={modules} missingPermissions={missing} />

        <div className="section-title">
          <h2>Commands</h2>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="card-header-text">
              <div className="card-title">Every command on this server</div>
              <p className="card-help">
                {plural(counts.total, "command")} · {live} in Discord
                {counts.featureOff > 0 ? ` · ${counts.featureOff} waiting for their feature` : ""}
                {counts.hidden > 0 ? ` · ${counts.hidden} switched off` : ""}
                {counts.restricted > 0 ? ` · ${counts.restricted} restricted` : ""}
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
