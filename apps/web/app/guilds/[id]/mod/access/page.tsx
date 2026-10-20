import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { StaffDto } from "@tier0/shared-moderation";
import { ControlApiError } from "../../../../../lib/control-api";
import { requireStaff } from "../../../../../lib/mod-access";
import { modStaff } from "../../../../../lib/mod-api";
import { AccessView } from "./AccessView";

export const metadata: Metadata = { title: "Access · Moderation" };

export default async function AccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireStaff(id, "staff.manage");
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }

  let staff: StaffDto[] | null = null;
  let loadError: string | undefined;
  try {
    staff = await modStaff(id);
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    loadError = error.message;
  }

  return <AccessView guildId={id} staff={staff} loadError={loadError} />;
}
