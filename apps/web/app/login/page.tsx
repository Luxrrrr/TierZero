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
    <AuthCard mark="0" brand={false}>
      <h1 className="auth-title">Sign in to TierZero</h1>
      <p className="auth-text">
        Use your Discord account. TierZero shows the servers you manage and the
        ones where you have been given moderation access.
      </p>
      <div className="auth-actions">
        <form action={signInWithDiscord}>
          <button type="submit" className="btn btn-discord btn-block">
            <DiscordMark />
            Continue with Discord
          </button>
        </form>
      </div>
      <p className="auth-foot">Self-hosted. Your data stays on your server.</p>
    </AuthCard>
  );
}
