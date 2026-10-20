import type { Metadata } from "next";
import type { AppealDetailDto, AppealListDto } from "@tier0/shared-moderation";
import { denyStaffPage } from "../../../../../lib/mod-deny";
import { requireStaff } from "../../../../../lib/mod-access";
import { requireGuildAccess } from "../../../../../lib/authz";
import { ControlApiError } from "../../../../../lib/control-api";
import { modAppeal, modAppeals } from "../../../../../lib/mod-api";
import { appealsApiParams, parseAppealsQuery } from "../../../../../lib/mod-appeals";
import { LoadError } from "../actions/LoadError";
import { AppealsView, type DetailState } from "./AppealsView";
import "../members/[userId]/profile.css";
import "../members/[userId]/actions.css";
import "./appeals.css";

export const metadata: Metadata = { title: "Appeals · Moderation" };

/** Reading an appeal shows the member's whole record, so the page needs the same level as deciding one. */
export default async function AppealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = parseAppealsQuery(await searchParams);

  const access = await requireStaff(id, "appeals.manage");
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }

  // Only decides whether the empty state links to the settings; the settings page checks again itself.
  const canConfigure = await requireGuildAccess(id).then(
    (result) => result.ok,
    () => false,
  );

  let list: AppealListDto;
  try {
    list = await modAppeals(id, appealsApiParams(query));
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return (
      <div className="mod-root mod-page">
        <LoadError what="ban appeals" status={error.status} message={error.message} />
      </div>
    );
  }

  // The open appeal is read on its own, so a link to one works whatever the list is filtered to.
  let detail: DetailState = null;
  if (query.appeal !== null) {
    try {
      const data: AppealDetailDto = await modAppeal(id, query.appeal);
      detail = { ok: true, data };
    } catch (error) {
      if (!(error instanceof ControlApiError)) throw error;
      detail = { ok: false, id: query.appeal, status: error.status, message: error.message };
    }
  }

  return <AppealsView guildId={id} query={query} list={list} detail={detail} canConfigure={canConfigure} />;
}
