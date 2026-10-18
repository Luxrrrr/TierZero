import Link from "next/link";
import type { BotGuildSummary } from "../lib/control-api";
import type { ModuleView } from "../lib/module-view";
import { statusWord } from "../lib/module-view";
import { areaHref, moduleHref } from "../lib/module-href";
import { inviteUrl } from "../lib/invite";
import { navGroups, railMarks } from "../lib/sections";
import { initialsOf } from "../lib/discord-cdn";
import { GuildSwitcher } from "./GuildSwitcher";
import { Logo } from "./Logo";
import { NavLink } from "./NavLink";
import { NavMarker } from "./NavMarker";
import { ComingSoon } from "./ComingSoon";
import { NavMore } from "./NavMore";
import { RoadmapList } from "./RoadmapList";
import { peekUpdateStatus } from "../lib/updates";
import { SidebarToggle } from "./SidebarToggle";
import { ThemeToggle } from "./ThemeToggle";
import { BotMessagesIcon, CommandsIcon, DownloadIcon, HelpIcon, MessagesIcon, OverviewIcon, SetupIcon, ShieldIcon, SignOutIcon, TicketIcon } from "./Icons";

interface Props {
  user: { name: string | null | undefined; image: string | null | undefined };
  guilds: BotGuildSummary[];
  /** Where each server in the switcher opens, for someone who can only use one area of it. */
  homes?: Record<string, string>;
  /** Absent on the server list, where there is nothing to navigate within. */
  currentGuild?: BotGuildSummary;
  modules: ModuleView[];
  /** Configure the server: overview, quick setup, commands and modules. */
  canManage?: boolean;
  /** Listed staff here, so the Moderation entry shows. */
  canModerate?: boolean;
  /** Works tickets here as a handler or through an admin role, so the Tickets entry shows. */
  canHandleTickets?: boolean;
  signOutAction(): Promise<void>;
}

export async function Sidebar({
  user,
  guilds,
  homes,
  currentGuild,
  modules,
  canManage = true,
  canModerate = false,
  canHandleTickets = false,
  signOutAction,
}: Props) {
  const groups = canManage ? navGroups(modules) : [];
  const marks = railMarks(groups.flatMap((group) => group.modules.map((module) => module.name)));
  // Never waits for GitHub: a stale answer starts a refresh and the next page sees it.
  const updates = await peekUpdateStatus();

  // Moderation is where hosted settings live, so a manager who is not listed
  // staff still gets the entry, pointing at the one tab they can open.
  const hosted = canManage ? modules.filter((module) => module.area === "moderation") : [];
  const showModeration = canModerate || hosted.length > 0;
  const needsSetup = hosted.some((module) => module.status === "attention");
  const moderationHref = currentGuild
    ? `/guilds/${currentGuild.id}/mod${canModerate ? "" : "/settings"}`
    : "";

  // Tickets takes over the module's own entry: the inbox is where most people
  // who open it are going, and its Settings tab holds what the entry used to.
  const tickets = canManage ? modules.find((module) => module.area === "tickets") : undefined;
  const showTickets = tickets !== undefined || canHandleTickets;
  const ticketsNeedSetup = tickets?.status === "attention";

  return (
    <>
      <div className="sidebar-head">
        <div className="sidebar-top">
          <Link href="/guilds" className="sidebar-brand" data-rail-tip="TierZero">
            <Logo />
            <span className="sidebar-brand-word">TierZero</span>
          </Link>
          <SidebarToggle />
        </div>
        <GuildSwitcher guilds={guilds} homes={homes} current={currentGuild} inviteUrl={inviteUrl()} />
      </div>

      <nav className="sidebar-nav" aria-label="Dashboard">
        <NavMarker />
        {currentGuild ? (
          <>
            <div className="nav-group">
              {canManage ? (
                <>
                  <NavLink href={`/guilds/${currentGuild.id}`} exact tip="Overview">
                    <OverviewIcon />
                    <span className="nav-link-text">Overview</span>
                  </NavLink>
                  <NavLink href={`/guilds/${currentGuild.id}/setup`} tip="Quick setup">
                    <SetupIcon />
                    <span className="nav-link-text">Quick setup</span>
                  </NavLink>
                  <NavLink href={`/guilds/${currentGuild.id}/commands`} tip="Commands">
                    <CommandsIcon />
                    <span className="nav-link-text">Commands</span>
                  </NavLink>
                  <NavLink href={`/guilds/${currentGuild.id}/messages`} tip="Message creator">
                    <MessagesIcon />
                    <span className="nav-link-text">Message creator</span>
                  </NavLink>
                  <NavLink href={`/guilds/${currentGuild.id}/bot-messages`} tip="Bot messages">
                    <BotMessagesIcon />
                    <span className="nav-link-text">Bot messages</span>
                  </NavLink>
                </>
              ) : null}
              {showModeration ? (
                <NavLink
                  href={moderationHref}
                  tip={needsSetup ? "Moderation · Needs setup" : "Moderation"}
                >
                  <ShieldIcon />
                  <span className="nav-link-text">Moderation</span>
                  {needsSetup ? (
                    <>
                      <span className="dot nav-flag" data-status="attention" aria-hidden="true" />
                      <span className="visually-hidden">, needs setup</span>
                    </>
                  ) : null}
                </NavLink>
              ) : null}
              {showTickets ? (
                <NavLink
                  href={areaHref(currentGuild.id, "tickets")}
                  tip={ticketsNeedSetup ? "Tickets · Needs setup" : "Tickets"}
                >
                  <TicketIcon />
                  <span className="nav-link-text">Tickets</span>
                  {ticketsNeedSetup ? (
                    <>
                      <span className="dot nav-flag" data-status="attention" aria-hidden="true" />
                      <span className="visually-hidden">, needs setup</span>
                    </>
                  ) : null}
                </NavLink>
              ) : null}
            </div>

            {groups.map((group) => {
              const links = group.modules.map((module) => (
                <NavLink
                  key={module.id}
                  href={moduleHref(currentGuild.id, module)}
                  tip={`${module.name} · ${statusWord(module.status)}`}
                >
                  <span className="nav-mono" aria-hidden="true">
                    {marks.get(module.name) ?? module.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="dot" data-status={module.status} aria-hidden="true" />
                  <span className="nav-link-text">{module.name}</span>
                  <span className="visually-hidden">, {statusWord(module.status).toLowerCase()}</span>
                </NavLink>
              ));
              // "More" holds the tools most servers never touch, so it starts folded.
              return group.id === "more" ? (
                <NavMore key={group.id} heading={group.heading}>
                  {links}
                </NavMore>
              ) : (
                <div className="nav-group" key={group.id}>
                  <div className="nav-group-title">{group.heading}</div>
                  {links}
                </div>
              );
            })}
          </>
        ) : (
          <div className="nav-group">
            <NavLink href="/guilds" exact tip="Your servers">
              <OverviewIcon />
              <span className="nav-link-text">Your servers</span>
            </NavLink>
          </div>
        )}

        <div className="nav-group nav-group-end">
          <NavLink href={currentGuild ? `/guilds/${currentGuild.id}/updates` : "/updates"} tip={updates.updateAvailable ? "Updates: a new version is out" : "Updates"}>
            <DownloadIcon />
            <span className="nav-link-text">Updates</span>
            {updates.updateAvailable ? (
              <>
                <span className="dot nav-flag" data-status="attention" aria-hidden="true" />
                <span className="visually-hidden">, a new version is available</span>
              </>
            ) : null}
          </NavLink>
          <ComingSoon count={updates.roadmap.length} changelogHref={currentGuild ? `/guilds/${currentGuild.id}/updates` : "/updates"}>
            <RoadmapList items={updates.roadmap} />
          </ComingSoon>
          <NavLink href="/help" tip="Help">
            <HelpIcon />
            <span className="nav-link-text">Help</span>
          </NavLink>
        </div>
      </nav>

      <div className="sidebar-foot">
        <div
          className="sidebar-user"
          role="group"
          tabIndex={0}
          aria-label={`Signed in as ${user.name ?? "you"}`}
          data-rail-tip={user.name ?? "Signed in"}
        >
          <span className="avatar avatar-sm" aria-hidden="true">
            {user.image ? (
              <img src={user.image} alt="" width={28} height={28} />
            ) : (
              initialsOf(user.name ?? "?")
            )}
          </span>
          <span className="sidebar-user-name">{user.name ?? "Signed in"}</span>
        </div>

        <div className="sidebar-foot-row">
          <ThemeToggle />
          <form action={signOutAction}>
            <button type="submit" className="btn btn-ghost btn-sm sidebar-signout" data-rail-tip="Sign out">
              <SignOutIcon />
              <span className="sidebar-signout-text">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
