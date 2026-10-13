import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../lib/guild-data";
import { moduleHref } from "../../../../lib/module-href";
import { orderModulesBySection } from "../../../../lib/sections";
import { BotOffline } from "../../../../components/BotOffline";
import { BotMessagesBrowser, type BrowserModule } from "../../../../components/BotMessagesBrowser";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const guilds = await botGuilds();
    const name = guilds.find((guild) => guild.id === id)?.name;
    return { title: name ? `Bot messages · ${name}` : "Bot messages" };
  } catch {
    return { title: "Bot messages" };
  }
}

/**
 * Every message the bot sends, from every feature, in one place. Nothing here
 * knows what any feature says: the messages are found by walking the same
 * settings schemas the feature pages are drawn from, so a feature that adds a
 * message setting shows up here without a line of dashboard code.
 */
export default async function BotMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const modules = await guildModules(id);
    // The bot's own replies come first, then the features in the order the sidebar lists them.
    const ordered = [
      ...modules.filter((module) => module.alwaysOn),
      ...orderModulesBySection(modules.filter((module) => !module.alwaysOn)),
    ];
    const browsable: BrowserModule[] = ordered.map((module) => ({
      id: module.id,
      name: module.name,
      enabled: module.enabled,
      alwaysOn: module.alwaysOn,
      schema: module.schema,
      settings: module.settings,
      href: moduleHref(id, module),
      commands: module.commands.map((command) => ({
        name: command.name,
        kind: command.kind,
        response: command.response,
        privateByDefault: command.privateByDefault,
        ephemeral: command.ephemeral,
        customReply: command.customReply,
      })),
    }));

    const system = modules.find((module) => module.alwaysOn);

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Server</p>
            <h1 className="page-title">Bot messages</h1>
            <p className="page-summary">
              Everything the bot says, in one list: replies, refusals, errors and the messages each feature
              sends. Change any of them here or on the feature&apos;s own page.
            </p>
          </div>
          {system ? (
            <div className="page-actions">
              <Link className="btn btn-secondary btn-sm" href={moduleHref(id, system)}>
                Labels and bot text
              </Link>
            </div>
          ) : null}
        </div>

        <BotMessagesBrowser guildId={id} modules={browsable} />
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
