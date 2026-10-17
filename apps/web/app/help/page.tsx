import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "../../lib/auth";
import { getAuthorizedGuildIds } from "../../lib/authz";
import { botGuilds } from "../../lib/guild-data";
import type { BotGuildSummary } from "../../lib/control-api";
import { SECTIONS } from "../../lib/sections";
import { FLOWS } from "../../lib/guided";
import { AppShell } from "../../components/AppShell";
import { HelpNav } from "../../components/HelpNav";
import { CheckIcon, ChevronDownIcon, FolderIcon, OverviewIcon, SetupIcon } from "../../components/Icons";
import { Sidebar } from "../../components/Sidebar";
import { signOutAction } from "../guilds/actions";
import { redirectToLogin } from "../../lib/auth-redirect";

export const metadata: Metadata = {
  title: "Help",
};

const SECTION_LINKS = [
  { id: "ideas", label: "The ideas" },
  { id: "features", label: "Features" },
  { id: "quick-setup", label: "Quick setup" },
  { id: "commands", label: "Commands" },
  { id: "tasks", label: "Common tasks" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "trouble", label: "Troubleshooting" },
];

/**
 * Written for somebody who runs a Discord server, not somebody who runs a
 * server. It explains the ideas the dashboard is built on (features, per
 * server settings, commands) rather than restating what each control does,
 * which the settings pages already say next to the control itself.
 *
 * It reads no guild data on purpose. Help is most wanted when something is
 * wrong, and a page that needs the bot to be up cannot explain that it is down.
 */
export default async function HelpPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToLogin();
  const user = { name: session.user.name, image: session.user.image };

  let guilds: BotGuildSummary[] = [];
  try {
    const [authorized, all] = await Promise.all([
      getAuthorizedGuildIds(session.user.id),
      botGuilds(),
    ]);
    guilds = all.filter((guild) => authorized.has(guild.id));
  } catch {
    // The sidebar's server picker is worth losing to keep the page readable
    // while the bot is down.
  }

  const firstGuild = guilds[0]?.id;

  return (
    <AppShell
      title="Help"
      sidebar={<Sidebar user={user} guilds={guilds} modules={[]} signOutAction={signOutAction} />}
    >
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-eyebrow">Help</p>
          <h1 className="page-title">How TierZero works</h1>
          <p className="page-summary">
            Everything the bot does is turned on and configured from this
            dashboard, one server at a time. You never need to edit a file or
            restart anything.
          </p>
        </div>
      </div>

      <HelpNav items={SECTION_LINKS} />

      <section className="help-section" id="ideas">
        <div className="help-head">
          <h2>The ideas</h2>
          <p>Four things explain most of the dashboard.</p>
        </div>
        <div className="help-grid help-grid-wide">
          <article className="help-card">
            <span className="help-card-icon" aria-hidden="true">
              <OverviewIcon />
            </span>
            <h3>Features</h3>
            <p>
              The bot is made of separate features: moderation, tickets,
              welcome messages and so on. Each one is off until you turn it on,
              and you turn it on per server. There is no paid tier.
            </p>
          </article>

          <article className="help-card">
            <span className="help-card-icon" aria-hidden="true">
              <FolderIcon />
            </span>
            <h3>Per server</h3>
            <p>
              Every setting belongs to one server. Turning on tickets in one
              server does nothing to another, even though the same bot is in
              both. Use the picker at the top of the sidebar to move between
              them.
            </p>
          </article>

          <article className="help-card">
            <span className="help-card-icon" aria-hidden="true">
              <CheckIcon />
            </span>
            <h3>Changes are immediate</h3>
            <p>
              A saved setting takes effect straight away, with no restart.
              Turn a feature off and it stops right then.
            </p>
          </article>

          <article className="help-card">
            <span className="help-card-icon" aria-hidden="true">
              <SetupIcon />
            </span>
            <h3>On, off, and needs setup</h3>
            <p>
              A coloured dot next to each feature shows its status. If
              something is missing, the feature page says what.
            </p>
            <ul className="help-key">
              <li>
                <span className="dot" data-status="on" aria-hidden="true" />
                <span>
                  <strong>On</strong> is working
                </span>
              </li>
              <li>
                <span className="dot" aria-hidden="true" />
                <span>
                  <strong>Off</strong> is doing nothing
                </span>
              </li>
              <li>
                <span className="dot" data-status="attention" aria-hidden="true" />
                <span>
                  <strong>Needs setup</strong> is on, but missing something it
                  cannot work without, a log channel say
                </span>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section className="help-section" id="features">
        <div className="help-head">
          <h2>What the features are</h2>
          <p>
            The sidebar groups them the same way. Which of these you actually
            have depends on what is installed.
          </p>
        </div>
        <div className="help-grid help-grid-narrow">
          {SECTIONS.map((section) => (
            <article className="help-card help-card-compact" key={section.id}>
              <h3>{section.heading}</h3>
              <p>{section.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="help-section" id="quick-setup">
        <div className="help-head">
          <h2>Quick setup</h2>
          <p>The short path, for when a full settings page is more than you want.</p>
        </div>
        <p className="help-lead">
          A feature&apos;s settings page shows every option it has, which is a
          lot if you are still deciding what you want. Quick setup asks only the
          few questions a feature needs, one screen at a time, and turns each
          feature on when you save its step. A feature that would still do
          nothing, such as Automod with every rule off, keeps your answers and
          stays off until it has what it needs.
        </p>
        <div className="help-grid help-grid-wide">
          <article className="help-card">
            <h3>A whole area at once</h3>
            <p>
              {FLOWS.map((flow) => flow.title).join(" and ")} each cover the
              features that are worth deciding together.
            </p>
          </article>
          <article className="help-card">
            <h3>One feature at a time</h3>
            <p>
              Every feature that offers a quick setup is listed on the same
              page, and there is a link to it from the feature&apos;s own
              settings page.
            </p>
          </article>
        </div>
        <div className="help-aside">
          <p>
            You can run it as many times as you like. It never removes anything:
            settings it does not ask about keep the values they already have, and
            skipping a step leaves that feature untouched. Anything it does set
            can be changed afterwards on the full page.
          </p>
          {firstGuild ? (
            <Link className="btn btn-primary" href={`/guilds/${firstGuild}/setup`}>
              Open quick setup
            </Link>
          ) : null}
        </div>
      </section>

      <section className="help-section" id="commands">
        <div className="help-head">
          <h2>Commands</h2>
          <p>The slash commands members type in Discord.</p>
        </div>
        <p className="help-lead">
          Turning a feature on adds its commands to your server, and turning it
          off takes them away again. The Commands page lists every one of them,
          marks the ones whose feature is off, and lets you do three things to
          each.
        </p>
        <div className="help-grid help-grid-three">
          <article className="help-card help-card-compact">
            <h3>Hide it</h3>
            <p>
              The command disappears from Discord on this server. The rest of
              the feature carries on working.
            </p>
          </article>
          <article className="help-card help-card-compact">
            <h3>Limit who can use it</h3>
            <p>
              Pick roles, and only members with one of them can run it. Everyone
              still sees it in their list, since Discord cannot hide a command by
              role. To hide it, choose members with a permission instead.
            </p>
          </article>
          <article className="help-card help-card-compact">
            <h3>Limit where it works</h3>
            <p>
              Pick the only channels it works in, or the channels it should not
              work in. A category covers every channel in it.
            </p>
          </article>
        </div>
        <p className="help-footnote">
          Changes reach Discord within a few seconds. Several switches flipped
          in a row are sent as one update.
        </p>
      </section>

      <section className="help-section" id="tasks">
        <div className="help-head">
          <h2>Common tasks</h2>
        </div>
        <div className="card faq">
          <details>
            <summary>
              Get started on a server
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Pick the server under <Link href="/guilds">Your servers</Link>. Every
              feature starts off. Switch one on from the overview, or open quick
              setup, which asks a few questions per feature. To check the bot is
              working, switch on Utility and type /ping in Discord. If a feature&apos;s
              tile says the bot is missing a permission, give the bot&apos;s role that
              permission in Discord&apos;s Server Settings, Roles.
            </div>
          </details>
          <details>
            <summary>
              Add the bot to another server
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Open <Link href="/guilds">Your servers</Link> and use the invite
              link there. It asks Discord for every permission the features use,
              so leave them ticked. You need the Manage Server permission on a
              server for it to appear in this dashboard.
            </div>
          </details>
          <details>
            <summary>
              Turn a feature off in a hurry
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              The switch on the server overview, or the one at the top of the
              feature&apos;s own page. It stops immediately. Its settings are
              kept, so turning it back on picks up where you left off.
            </div>
          </details>
          <details>
            <summary>
              Change what a message says
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Message fields show a preview as you type, and list the
              placeholders you can use, things like the member&apos;s name or the
              server&apos;s. Put the placeholder in the text and the bot fills it
              in when it sends.
            </div>
          </details>
          <details>
            <summary>
              Stop moderators being caught by automod
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Automod has an exempt roles list that applies to every rule, and
              each rule has its own list as well. By default it also leaves alone
              anyone who can manage messages or time others out.
            </div>
          </details>
        </div>
      </section>

      <section className="help-section" id="shortcuts">
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <p>On a Mac, use Cmd where this says Ctrl.</p>
        </div>
        <div className="card">
          <dl className="help-shortcuts">
            <div>
              <dt>
                <kbd>Ctrl</kbd> + <kbd>B</kbd>
              </dt>
              <dd>Folds the sidebar away or brings it back. In a message text box it makes the selected text bold instead.</dd>
            </div>
            <div>
              <dt>
                <kbd>Ctrl</kbd> + <kbd>I</kbd>, <kbd>Ctrl</kbd> + <kbd>U</kbd>
              </dt>
              <dd>In a message text box, italic and underline.</dd>
            </div>
            <div>
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>Jumps to the search box on the Commands and Bot messages pages.</dd>
            </div>
            <div>
              <dt>
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
              </dt>
              <dd>Saves a feature&apos;s settings page.</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Closes the panel or dialog that is open.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="help-section" id="trouble">
        <div className="help-head">
          <h2>When something looks wrong</h2>
        </div>
        <div className="card faq">
          <details>
            <summary>
              The dashboard says it cannot reach the bot
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              The dashboard and the bot are two separate programs. This message
              means the bot is not running, or the dashboard cannot reach it.
              Whoever installed TierZero can start it again; the page checks by
              itself every few seconds and carries on once the bot answers. Your
              settings are safe, since they are kept on disk.
            </div>
          </details>
          <details>
            <summary>
              A feature is on but nothing happens
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Look for <strong>Needs setup</strong> next to it. That means a
              setting it cannot work without is still empty, and the feature page
              names which one.
            </div>
          </details>
          <details>
            <summary>
              A role is greyed out
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              The bot cannot give out a role that sits above its own in your
              server&apos;s role list, so where a setting hands a role to members
              (a role menu, a welcome role, a level reward) those roles are greyed
              out. Move the bot&apos;s role above them in Discord&apos;s server
              settings and they become selectable. Settings that only check a
              role, such as who can use a command, offer every role.
            </div>
          </details>
          <details>
            <summary>
              A command is missing in Discord
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Check the feature is on, then check on the Commands page that the
              command is not switched off and is not limited to members with a
              permission you do not have. A role limit does not hide a command.
              Discord can take a few seconds to catch up. If it still does not
              appear, press Ctrl+R in Discord to reload it. If the server overview
              says Discord did not accept the commands, add the bot again with
              the invite link on Your servers.
            </div>
          </details>
          <details>
            <summary>
              A server icon is missing
              <ChevronDownIcon />
            </summary>
            <div className="faq-body">
              Servers without a custom icon show their initials instead.
            </div>
          </details>
        </div>
      </section>
    </AppShell>
  );
}
