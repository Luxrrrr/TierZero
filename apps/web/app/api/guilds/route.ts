import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { getAuthorizedGuildIds } from "../../../lib/authz";
import { listBotGuilds } from "../../../lib/control-api";
import { proxyControlApi } from "../../../lib/api-helpers";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const userId = session.user.id;
  return proxyControlApi(async () => {
    const [authorized, botGuilds] = await Promise.all([
      getAuthorizedGuildIds(userId),
      listBotGuilds(),
    ]);
    return botGuilds.filter((guild) => authorized.has(guild.id));
  });
}
