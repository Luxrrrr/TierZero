import type { Metadata } from "next";
import { auth } from "../../../../lib/auth";
import { isInstanceOwner } from "../../../../lib/instance";
import { getBotProfile, type BotProfile } from "../../../../lib/control-api";
import { BotProfileContent } from "../../../../components/BotProfileContent";
import { redirectToLogin } from "../../../../lib/auth-redirect";

export const metadata: Metadata = { title: "Bot profile" };

/** The bot's profile inside a server's navigation, so the sidebar keeps the server's pages. It is about the whole install, not this server. */
export default async function GuildBotProfilePage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToLogin();
  const [profile, owner] = await Promise.all([getBotProfile().catch((): BotProfile | null => null), isInstanceOwner(session.user.id)]);
  return <BotProfileContent profile={profile} owner={owner} />;
}
