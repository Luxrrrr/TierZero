import type { Metadata } from "next";
import { auth } from "../../../../lib/auth";
import { isInstanceOwner } from "../../../../lib/instance";
import { getUpdateStatus } from "../../../../lib/updates";
import { UpdatesContent } from "../../../../components/UpdatesContent";
import { redirectToLogin } from "../../../../lib/auth-redirect";

export const metadata: Metadata = { title: "Updates" };

/**
 * Updates inside a server's navigation, so the sidebar keeps the server's pages. What it shows is about the whole
 * install, not this server. The server layout has already checked that the person may open the server.
 */
export default async function GuildUpdatesPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToLogin();
  const [status, owner] = await Promise.all([getUpdateStatus(), isInstanceOwner(session.user.id)]);
  return <UpdatesContent status={status} owner={owner} />;
}
