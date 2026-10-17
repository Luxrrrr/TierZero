import type { Metadata } from "next";
import { can, type RaidStatusDto } from "@tier0/core";
import { denyStaffPage } from "../../../../../lib/mod-deny";
import { requireStaff } from "../../../../../lib/mod-access";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { modRaid } from "../../../../../lib/mod-api";
import { LoadError } from "../actions/LoadError";
import { RaidTools } from "./RaidTools";
import "../members/[userId]/profile.css";
import "../members/[userId]/actions.css";
import "../danger/danger.css";
import "./raid.css";

export const metadata: Metadata = { title: "Raid tools · Moderation" };

/** Locking channels starts at admin. Acting on many members at once is its own permission, checked for that panel. */
export default async function RaidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireStaff(id, "raid.lockdown");
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }

  const canConfigure = await requireGuildAccess(id).then(
    (result) => result.ok,
    () => false,
  );

  let status: RaidStatusDto;
  try {
    status = await modRaid(id);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return (
      <div className="mod-root mod-page">
        <LoadError what="the raid tools" status={error.status} message={error.message} />
      </div>
    );
  }

  return (
    <div className="mod-root mod-page raid-page">
      <RaidTools guildId={id} initial={status} canMass={can(access.role, "raid.mass")} canConfigure={canConfigure} />
    </div>
  );
}
