import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { getAuthorizedGuildIds } from "../../lib/authz";
import { botGuilds } from "../../lib/guild-data";
import { getBotProfile, type BotGuildSummary, type BotProfile } from "../../lib/control-api";
import { isInstanceOwner } from "../../lib/instance";
import { AppShell } from "../../components/AppShell";
import { Sidebar } from "../../components/Sidebar";
import { BotProfileContent } from "../../components/BotProfileContent";
import { signOutAction } from "../guilds/actions";

export const metadata: Metadata = { title: "Bot profile" };

/** How the bot shows itself. Anyone signed in can read it. Changing it is the owner's. */
export default async function BotProfilePage() {
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

  const [profile, owner] = await Promise.all([getBotProfile().catch((): BotProfile | null => null), isInstanceOwner(session.user.id)]);

  return (
    <AppShell title="Bot profile" sidebar={<Sidebar user={user} guilds={guilds} modules={[]} signOutAction={signOutAction} />}>
      <BotProfileContent profile={profile} owner={owner} />
    </AppShell>
  );
}
