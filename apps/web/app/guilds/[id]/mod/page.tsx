import { forbidden, redirect } from "next/navigation";
import type { InfractionDto, StatsDto } from "@tier0/core";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { requireStaff } from "../../../../lib/mod-access";
import { modInfractions, modStats } from "../../../../lib/mod-api";
import "../../../mod.css";
import "./stats.css";
import { ModStatsView, StatsToolbar, StatsUnavailable } from "./StatsView";
import { parseRange } from "./stats-logic";

export const metadata = { title: "Overview · Moderation" };

export default async function ModOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const { id } = await params;
  const days = parseRange((await searchParams).days);

  const access = await requireStaff(id, "stats.view");
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }

  // The feed is a convenience: if it fails, the rest of the page still renders.
  const feed: Promise<InfractionDto[] | null> = modInfractions(id, { pageSize: 8 }).then(
    (page) => page.items,
    () => null,
  );

  let stats: StatsDto;
  try {
    stats = await modStats(id, days);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    const message =
      error.status === 404
        ? "The bot has no statistics for this server. If TierZero was just updated, restart the bot and reload this page."
        : error.message;
    return (
      <div className="mod-page stats-page">
        <StatsToolbar guildId={id} days={days} />
        <StatsUnavailable message={message} />
      </div>
    );
  }

  // Only used to word a hint, so a failed lookup just drops the hint.
  const canConfigure = await requireGuildAccess(id).then(
    (result) => result.ok,
    () => false,
  );

  return <ModStatsView guildId={id} stats={stats} recent={await feed} canConfigure={canConfigure} />;
}
