import { denyStaffPage } from "../../../../lib/mod-deny";
import type { InfractionDto, StatsDto } from "@tier0/core";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { requireStaff } from "../../../../lib/mod-access";
import { modInfractions, modStats } from "../../../../lib/mod-api";
import "../../../mod.css";
import "./stats.css";
import { ModStatsView, StatsToolbar, StatsUnavailable } from "./StatsView";
import { parseRangeSpec, rangeParams } from "./stats-logic";

export const metadata = { title: "Overview · Moderation" };

type Search = string | string[] | undefined;

export default async function ModOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: Search; range?: Search; from?: Search; to?: Search }>;
}) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const spec = parseRangeSpec(await searchParams, today);

  const access = await requireStaff(id, "stats.view");
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }

  // The feed is a convenience: if it fails, the rest of the page still renders.
  const feed: Promise<InfractionDto[] | null> = modInfractions(id, { pageSize: 8 }).then(
    (page) => page.items,
    () => null,
  );

  let stats: StatsDto;
  try {
    stats = await modStats(id, rangeParams(spec));
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    const message =
      error.status === 404
        ? "The bot has no statistics for this server. If TierZero was just updated, restart the bot and reload this page."
        : error.message;
    return (
      <div className="mod-page stats-page">
        <StatsToolbar guildId={id} spec={spec} today={today} />
        <StatsUnavailable message={message} />
      </div>
    );
  }

  // Only used to word a hint, so a failed lookup just drops the hint.
  const canConfigure = await requireGuildAccess(id).then(
    (result) => result.ok,
    () => false,
  );

  return (
    <ModStatsView guildId={id} spec={spec} today={today} stats={stats} recent={await feed} canConfigure={canConfigure} />
  );
}
