import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { auth } from "../../lib/auth";
import { accessibleGuilds, guildHome, guildRoleLabel, type AccessibleGuilds } from "../../lib/guild-access";
import { ControlApiError, type BotGuildSummary } from "../../lib/control-api";
import { botGuilds, guildModules } from "../../lib/guild-data";
import { AppShell } from "../../components/AppShell";
import { Sidebar } from "../../components/Sidebar";
import { inviteUrl } from "../../lib/invite";
import { BotOffline } from "../../components/BotOffline";
import { guildIconUrl, initialsOf } from "../../lib/discord-cdn";
import { ChevronRightIcon, DiscordMark, ExternalLinkIcon } from "../../components/Icons";
import { signOutAction } from "./actions";
import { redirectToLogin } from "../../lib/auth-redirect";

export const metadata: Metadata = {
  title: "Your servers",
};

interface GuildCard {
  guild: BotGuildSummary;
  /** Where the card goes: the overview, or the one area the person was given. */
  href: string;
  /** "Moderation" or "Tickets" when that area is all the person can open here. */
  role: string | null;
  /** Null when this one guild's module list could not be read, or the user cannot see it. */
  features: { on: number; total: number } | null;
}

export default async function GuildsPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToLogin();
  const user = { name: session.user.name, image: session.user.image };
  const invite = inviteUrl();

  let guilds: BotGuildSummary[];
  let accessible: AccessibleGuilds;
  try {
    const [found, all] = await Promise.all([accessibleGuilds(session.user.id), botGuilds()]);
    accessible = found;
    guilds = all.filter((guild) => accessible.all.has(guild.id));
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
        <BotOffline ownHeading={false} />
      </AppShell>
    );
  }

  // One failing guild should cost that guild its feature count, not the page.
  const cards: GuildCard[] = await Promise.all(
    guilds.map(async (guild) => {
      const href = guildHome(guild.id, accessible);
      const role = guildRoleLabel(guild.id, accessible);
      if (!accessible.managed.has(guild.id)) return { guild, href, role, features: null };
      try {
        const modules = (await guildModules(guild.id)).filter((module) => !module.alwaysOn);
        return {
          guild,
          href,
          role,
          features: { on: modules.filter((module) => module.enabled).length, total: modules.length },
        };
      } catch {
        return { guild, href, role, features: null };
      }
    }),
  );

  return (
    <AppShell
      title="Your servers"
      sidebar={
        <Sidebar
          user={user}
          guilds={guilds}
          homes={Object.fromEntries(cards.map((card) => [card.guild.id, card.href]))}
          modules={[]}
          signOutAction={signOutAction}
        />
      }
    >
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Your servers</h1>
          <p className="page-summary">
            Servers you manage that TierZero has been invited to, and servers
            where you moderate or work tickets.
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
            To change a server's settings, invite the bot to one where you have the
            Manage Server permission. That is a Discord permission set on roles
            under Server Settings, and the server's owner always has it. Then
            reload this page. To moderate one, ask the owner of this installation
            to add you to its staff. To work its tickets, ask for one of the
            roles its ticket types are handled by.
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
          {cards.map(({ guild, features, href, role }, index) => {
            const icon = guildIconUrl(guild.id, guild.icon, 96);
            return (
              <Link
                key={guild.id}
                href={href}
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
                    {role ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{role}</span>
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
