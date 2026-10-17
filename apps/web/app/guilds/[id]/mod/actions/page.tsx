import { denyStaffPage } from "../../../../../lib/mod-deny";
import type { Metadata } from "next";
import { can, type UserRef } from "@tier0/core";
import { requireStaff } from "../../../../../lib/mod-access";
import { ControlApiError } from "../../../../../lib/control-api";
import { modInfractions, modStaff } from "../../../../../lib/mod-api";
import { ActionLog } from "./ActionLog";
import { LoadError } from "./LoadError";
import {
  actionsApiParams,
  parseActionsQuery,
} from "./params";

export const metadata: Metadata = { title: "Mod logs · Moderation" };

async function staffUsers(guildId: string): Promise<UserRef[]> {
  try {
    return (await modStaff(guildId)).map((entry) => entry.user);
  } catch (error) {
    // The select still works from the rows on screen if the staff list is unavailable.
    if (error instanceof ControlApiError) return [];
    throw error;
  }
}

export default async function ActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = parseActionsQuery(await searchParams);

  const access = await requireStaff(id, "view");
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }

  try {
    const [data, staff] = await Promise.all([modInfractions(id, actionsApiParams(query)), staffUsers(id)]);
    return (
      <ActionLog
        guildId={id}
        query={query}
        data={data}
        staff={staff}
        canExport={can(access.role, "audit.view")}
      />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <LoadError what="member actions" status={error.status} message={error.message} />;
  }
}
