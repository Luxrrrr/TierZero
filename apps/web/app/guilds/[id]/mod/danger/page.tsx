import type { Metadata } from "next";
import { denyStaffPage } from "../../../../../lib/mod-deny";
import { requireStaff } from "../../../../../lib/mod-access";
import { modDangerCounts, type DangerCounts } from "../../../../../lib/mod-api";
import { DangerZone } from "./DangerZone";
import "./danger.css";

export const metadata: Metadata = { title: "Danger zone · Moderation" };

/** Only the owner holds the purge permission, so only the owner gets past this. */
export default async function DangerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireStaff(id, "purge");
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }
  // The counts only inform; the page still works without them, as with an older bot.
  const counts: DangerCounts | null = await modDangerCounts(id).catch(() => null);
  return (
    <div className="mod-root mod-page">
      <DangerZone guildId={id} counts={counts} />
    </div>
  );
}
