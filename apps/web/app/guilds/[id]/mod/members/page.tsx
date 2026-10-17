import { denyStaffPage } from "../../../../../lib/mod-deny";
import type { Metadata } from "next";
import { ControlApiError } from "../../../../../lib/control-api";
import { requireStaff } from "../../../../../lib/mod-access";
import { modMembers } from "../../../../../lib/mod-api";
import "../../../../mod.css";
import "./members.css";
import { MemberList, MemberListError } from "./MemberList";
import { MEMBER_PAGE_SIZE, parseMemberQuery } from "./params";

export const metadata: Metadata = { title: "Members · Moderation" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const access = await requireStaff(id);
  if (!access.ok) {
    return denyStaffPage(id, access.status);
  }

  const query = parseMemberQuery(await searchParams);

  let content;
  try {
    const data = await modMembers(id, { ...query, pageSize: MEMBER_PAGE_SIZE });
    content = <MemberList guildId={id} data={data} query={query} />;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    content = <MemberListError guildId={id} message={error.message} query={query} />;
  }

  return content;
}
