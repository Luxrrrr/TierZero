import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../../../lib/auth";
import { isInstanceOwner } from "../../../../lib/instance";
import { getUpdateStatus } from "../../../../lib/updates";
import { UpdatesContent } from "../../../../components/UpdatesContent";

export const metadata: Metadata = { title: "Updates" };

/**
 * Updates inside a server's navigation, so the sidebar keeps the server's pages. What it shows is about the whole
 * install, not this server. The server layout has already checked that the person may open the server.
 */
export default async function GuildUpdatesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [status, owner] = await Promise.all([getUpdateStatus(), isInstanceOwner(session.user.id)]);
  return <UpdatesContent status={status} owner={owner} />;
}
