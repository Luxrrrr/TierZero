import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { accessibleGuilds } from "../../lib/guild-access";
import { ControlApiError, type BotGuildSummary } from "../../lib/control-api";
import { botGuilds, guildModules } from "../../lib/guild-data";
import { AppShell } from "../../components/AppShell";
import { Sidebar } from "../../components/Sidebar";
import { BotOffline } from "../../components/BotOffline";
import { guildIconUrl, initialsOf } from "../../lib/discord-cdn";
import { ChevronRightIcon, DiscordMark, ExternalLinkIcon } from "../../components/Icons";
import { signOutAction } from "./actions";

export const metadata: Metadata = {
  title: "Your servers",
};

// The scopes the bot needs for every feature. Documented alongside the same
// number in docs/install.md; changing one means changing both.
const INVITE_PERMISSIONS = "1391837965526";

function inviteUrl(): string | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
}

interface GuildCard {
  guild: BotGuildSummary;
  /** Listed staff here without Manage Server: the card opens the mod dashboard only. */
  staffOnly: boolean;
  /** Null when this one guild's module list could not be read, or the user cannot see it. */
  features: { on: number; total: number } | null;
}

export default async function GuildsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = { name: session.user.name, image: session.user.image };
  const invite = inviteUrl();

  let guilds: BotGuildSummary[];
  let managed: Set<string>;
  try {
    const [accessible, all] = await Promise.all([accessibleGuilds(session.user.id), botGuilds()]);
    guilds = all.filter((guild) => accessible.all.has(guild.id));
    managed = accessible.managed;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return (
      <AppShell
        title="Your servers"
        sidebar={<Sidebar user={user} guilds={[]} modules={[]} signOutAction={signOutAction} />}
      >
        <div className="page-header">
          <div className="page-header-text">
            <h1 className="page-title">Your servers</h1>
          </div>
        </div>
        <BotOffline />
      </AppShell>
    );
  }

  // One failing guild should cost that guild its feature count, not the page.
  const cards: GuildCard[] = await Promise.all(
    guilds.map(async (guild) => {
      if (!managed.has(guild.id)) return { guild, staffOnly: true, features: null };
      try {
        const modules = await guildModules(guild.id);
        return {
          guild,
          staffOnly: false,
          features: { on: modules.filter((module) => module.enabled).length, total: modules.length },
        };
      } catch {
        return { guild, staffOnly: false, features: null };
      }
    }),
  );

  return (
    <AppShell
      title="Your servers"
      sidebar={<Sidebar user={user} guilds={guilds} modules={[]} signOutAction={signOutAction} />}
    >
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Your servers</h1>
          <p className="page-summary">
            Servers you manage that TierZero has been invited to, and servers
            where you have been given moderation access.
          </p>
        </div>
        {invite && guilds.length > 0 ? (
          <div className="page-actions">
            <a className="btn btn-ghost" href={invite} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Invite to another server
            </a>
          </div>
        ) : null}
      </div>

      {guilds.length === 0 ? (
        <div className="empty">
          <DiscordMark className="empty-icon" />
          <p className="empty-title">No servers to show yet</p>
          <p className="empty-text">
            To configure a server, invite the bot to one where you have the
            Manage Server permission, then reload this page. To moderate one,
            ask the owner of this installation to add you to its staff.
          </p>
          {invite ? (
            <div className="empty-actions">
              <a className="btn btn-primary" href={invite} target="_blank" rel="noreferrer">
                <DiscordMark />
                Invite the bot
              </a>
            </div>
          ) : (
            <p className="empty-text">
              The invite link needs DISCORD_CLIENT_ID in your .env file. Add
              your application ID there and restart the dashboard.
            </p>
          )}
        </div>
      ) : (
        <div className="guild-grid">
          {cards.map(({ guild, features, staffOnly }, index) => {
            const icon = guildIconUrl(guild.id, guild.icon, 96);
            return (
              <Link
                key={guild.id}
                href={staffOnly ? `/guilds/${guild.id}/mod` : `/guilds/${guild.id}`}
                className="guild-card rise"
                style={{ "--i": index } as CSSProperties}
              >
                <span className="avatar" aria-hidden="true">
                  {icon ? <img src={icon} alt="" width={48} height={48} /> : initialsOf(guild.name)}
                </span>
                <span className="guild-card-text">
                  <span className="guild-card-name">{guild.name}</span>
                  <span className="guild-card-meta">
                    <span>{guild.memberCount.toLocaleString()} members</span>
                    {staffOnly ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Moderation</span>
                      </>
                    ) : features ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {features.on} of {features.total} features on
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                <ChevronRightIcon className="chevron" />
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
