import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "../../lib/auth";
import { getAuthorizedGuildIds } from "../../lib/authz";
import { listBotGuilds } from "../../lib/control-api";

export default async function GuildsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [authorized, botGuilds] = await Promise.all([
    getAuthorizedGuildIds(session.user.id),
    listBotGuilds(),
  ]);
  const guilds = botGuilds.filter((guild) => authorized.has(guild.id));

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main>
      <h1>Your servers</h1>
      {guilds.length === 0 ? (
        <p>
          The bot isn&apos;t in a server you manage, or you don&apos;t have the
          Manage Server permission there. Invite the bot to a server you
          manage, then reload this page.
        </p>
      ) : (
        <ul>
          {guilds.map((guild) => (
            <li key={guild.id}>
              <Link href={`/guilds/${guild.id}`}>{guild.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
