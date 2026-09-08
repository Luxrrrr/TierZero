import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signIn } from "../../lib/auth";
import { AuthCard } from "../../components/AuthCard";
import { DiscordMark } from "../../components/Icons";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/guilds");

  async function signInWithDiscord() {
    "use server";
    await signIn("discord", { redirectTo: "/guilds" });
  }

  return (
    <AuthCard mark="0">
      <h1>TierZero</h1>
      <p>Sign in with the Discord account you use to manage your server.</p>
      <form action={signInWithDiscord}>
        <button type="submit" className="btn btn-primary">
          <DiscordMark />
          Sign in with Discord
        </button>
      </form>
    </AuthCard>
  );
}
