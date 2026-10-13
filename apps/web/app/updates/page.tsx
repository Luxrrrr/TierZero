import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { getAuthorizedGuildIds } from "../../lib/authz";
import { botGuilds } from "../../lib/guild-data";
import type { BotGuildSummary } from "../../lib/control-api";
import { isInstanceOwner } from "../../lib/instance";
import { getUpdateStatus } from "../../lib/updates";
import { AppShell } from "../../components/AppShell";
import { Sidebar } from "../../components/Sidebar";
import { UpdatesContent } from "../../components/UpdatesContent";
import { signOutAction } from "../guilds/actions";

export const metadata: Metadata = { title: "Updates" };

/**
 * The install's version, what is new since, and what is coming. Anyone signed in can read it. The controls are
 * the owner's. It does not apply an update: that needs a terminal on the machine the bot runs on, and giving the
 * dashboard the power to replace itself would also give it the power to run anything on that machine.
 */
export default async function UpdatesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = { name: session.user.name, image: session.user.image };

  let guilds: BotGuildSummary[] = [];
  try {
    const [authorized, all] = await Promise.all([getAuthorizedGuildIds(session.user.id), botGuilds()]);
    guilds = all.filter((guild) => authorized.has(guild.id));
  } catch {
    // The server picker is not worth failing this page for.
  }

  const [status, owner] = await Promise.all([getUpdateStatus(), isInstanceOwner(session.user.id)]);

  return (
    <AppShell title="Updates" sidebar={<Sidebar user={user} guilds={guilds} modules={[]} signOutAction={signOutAction} />}>
      <UpdatesContent status={status} owner={owner} />
    </AppShell>
  );
}
