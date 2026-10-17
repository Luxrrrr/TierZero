import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { botGuilds, guildModules } from "../../../../../lib/guild-data";
import { flowById } from "../../../../../lib/guided";
import { guidedSteps } from "../../../../../lib/guided-steps";
import { BotOffline } from "../../../../../components/BotOffline";
import { GuidedSetup } from "../../../../../components/GuidedSetup";
import { redirectToLogin } from "../../../../../lib/auth-redirect";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ flow: string }>;
}): Promise<Metadata> {
  const { flow } = await params;
  const title = flowById(flow)?.title;
  return { title: title ? `${title} setup` : "Quick setup" };
}

/** One of the named bundles from the quick setup hub. */
export default async function FlowSetupPage({
  params,
}: {
  params: Promise<{ id: string; flow: string }>;
}) {
  const { id, flow: flowId } = await params;
  const flow = flowById(flowId);
  if (!flow) redirect(`/guilds/${id}/setup`);

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) await redirectToLogin();
      forbidden();
    }

    const [modules, guilds] = await Promise.all([guildModules(id), botGuilds()]);
    const steps = guidedSteps(modules, flow.modules);
    // Every module in the bundle is missing or has nothing to ask about, which
    // leaves no wizard to run.
    if (steps.length === 0) redirect(`/guilds/${id}/setup`);

    return (
      <GuidedSetup
        guildId={id}
        serverName={guilds.find((guild) => guild.id === id)?.name ?? "your server"}
        title={flow.title}
        blurb={flow.blurb}
        steps={steps}
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
