import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireStaff } from "../../../../../lib/mod-access";
import { DangerZone } from "./DangerZone";
import "./danger.css";

export const metadata: Metadata = { title: "Danger zone · Moderation" };

/** Only the owner holds the purge permission, so only the owner gets past this. */
export default async function DangerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireStaff(id, "purge");
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }
  return (
    <div className="mod-root mod-page">
      <DangerZone guildId={id} />
    </div>
  );
}
