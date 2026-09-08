import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { getAuthorizedGuildIds } from "../../lib/authz";
import { ControlApiError, listBotGuilds, type BotGuildSummary } from "../../lib/control-api";
import { BotOffline } from "../../components/BotOffline";
import { guildIconUrl, initialsOf } from "../../lib/discord-cdn";
import { ChevronRightIcon } from "../../components/Icons";

export const metadata: Metadata = {
  title: "Your servers",
};

export default async function GuildsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let guilds: BotGuildSummary[];
  try {
    const [authorized, botGuilds] = await Promise.all([
      getAuthorizedGuildIds(session.user.id),
      listBotGuilds(),
    ]);
    guilds = botGuilds.filter((guild) => authorized.has(guild.id));
  } catch (error) {
    if (error instanceof ControlApiError) return <BotOffline />;
    throw error;
  }

  return (
    <>
      <div className="shell-main-header">
        <h1>Your servers</h1>
      </div>

      {guilds.length === 0 ? (
        <div className="empty-state">
          <p>
            The bot isn&apos;t in a server you manage, or you don&apos;t have
            the Manage Server permission there. Invite the bot to a server you
            manage, then reload this page.
          </p>
        </div>
      ) : (
        <ul className="guild-list">
          {guilds.map((guild) => {
            const icon = guildIconUrl(guild.id, guild.icon, 48);
            return (
              <li key={guild.id}>
                <Link href={`/guilds/${guild.id}`}>
                  <span className="guild-icon" aria-hidden="true">
                    {icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={icon} alt="" width={36} height={36} />
                    ) : (
                      initialsOf(guild.name)
                    )}
                  </span>
                  <span className="guild-name">{guild.name}</span>
                  <span className="guild-meta">
                    {guild.memberCount.toLocaleString()} members
                  </span>
                  <ChevronRightIcon className="chevron" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
