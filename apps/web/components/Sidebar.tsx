import Link from "next/link";
import type { BotGuildSummary } from "../lib/control-api";
import type { ModuleView } from "../lib/module-view";
import { statusWord } from "../lib/module-view";
import { isHosted, moduleHref } from "../lib/module-href";
import { navGroups } from "../lib/sections";
import { initialsOf } from "../lib/discord-cdn";
import { GuildSwitcher } from "./GuildSwitcher";
import { NavLink } from "./NavLink";
import { SidebarToggle } from "./SidebarToggle";
import { ThemeToggle } from "./ThemeToggle";
import { CommandsIcon, HelpIcon, OverviewIcon, SetupIcon, ShieldIcon, SignOutIcon } from "./Icons";

interface Props {
  user: { name: string | null | undefined; image: string | null | undefined };
  guilds: BotGuildSummary[];
  /** Absent on the server list, where there is nothing to navigate within. */
  currentGuild?: BotGuildSummary;
  modules: ModuleView[];
  /** Configure the server: overview, quick setup, commands and modules. */
  canManage?: boolean;
  /** Listed staff here, so the Moderation entry shows. */
  canModerate?: boolean;
  signOutAction(): Promise<void>;
}

export function Sidebar({
  user,
  guilds,
  currentGuild,
  modules,
  canManage = true,
  canModerate = false,
  signOutAction,
}: Props) {
  const groups = canManage ? navGroups(modules) : [];

  // Moderation is where hosted settings live, so a manager who is not listed
  // staff still gets the entry, pointing at the one tab they can open.
  const hosted = canManage ? modules.filter(isHosted) : [];
  const showModeration = canModerate || hosted.length > 0;
  const needsSetup = hosted.some((module) => module.status === "attention");
  const moderationHref = currentGuild
    ? `/guilds/${currentGuild.id}/mod${canModerate ? "" : "/settings"}`
    : "";

  return (
    <>
      <div className="sidebar-head">
        <div className="sidebar-top">
          <Link href="/guilds" className="sidebar-brand" data-rail-tip="TierZero">
            <span className="mark" aria-hidden="true">
              0
            </span>
            <span className="sidebar-brand-word">TierZero</span>
          </Link>
          <SidebarToggle />
        </div>
        <GuildSwitcher guilds={guilds} current={currentGuild} />
      </div>

      <nav className="sidebar-nav" aria-label="Dashboard">
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
            </div>

            {groups.map((group) => (
              <div className="nav-group" key={group.id}>
                <div className="nav-group-title">{group.heading}</div>
                {group.modules.map((module) => (
                  <NavLink
                    key={module.id}
                    href={moduleHref(currentGuild.id, module)}
                    tip={`${module.name} · ${statusWord(module.status)}`}
                  >
                    <span className="nav-mono" aria-hidden="true">
                      {module.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="dot" data-status={module.status} aria-hidden="true" />
                    <span className="nav-link-text">{module.name}</span>
                    <span className="visually-hidden">, {statusWord(module.status).toLowerCase()}</span>
                  </NavLink>
                ))}
              </div>
            ))}
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
