import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../../lib/guild-data";
import { guidedSteps } from "../../../../../lib/guided-steps";
import { BotOffline } from "../../../../../components/BotOffline";
import { GuidedSetup } from "../../../../../components/GuidedSetup";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}): Promise<Metadata> {
  const { id, moduleId } = await params;
  try {
    const name = (await guildModules(id)).find((module) => module.id === moduleId)?.name;
    return { title: name ? `${name} setup` : "Quick setup" };
  } catch {
    return { title: "Quick setup" };
  }
}

/**
 * The quick setup for one feature. Reachable from that feature's own settings
 * page, so somebody who opened the full page and found it more than they
 * wanted has a way back to the short version.
 */
export default async function ModuleSetupPage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const [modules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const steps = guidedSteps(modules, [moduleId]);
    // Either no such module, or one whose schema tagged nothing worth asking
    // about. The full settings page is the only way to configure that one.
    if (steps.length === 0) redirect(`/guilds/${id}/${moduleId}`);

    const [step] = steps;
    return (
      <GuidedSetup
        guildId={id}
        serverName={guilds.find((guild) => guild.id === id)?.name ?? "your server"}
        title={step?.name ?? "Quick setup"}
        blurb="The few settings this feature needs before it is any use. Everything else keeps the value it already has."
        steps={steps}
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
