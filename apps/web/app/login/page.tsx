import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signIn } from "../../lib/auth";
import { isInstanceClaimed } from "../../lib/instance";
import { safeNext } from "../../lib/login-redirect";
import { AuthCard } from "../../components/AuthCard";
import { DiscordMark } from "../../components/Icons";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Sign in",
};

// Whether the install has an owner yet is read on every visit.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  // Until the bot has recorded who owns the install there is nothing to sign in to.
  if (!(await isInstanceClaimed())) redirect("/setup");

  const next = safeNext((await searchParams).next) ?? "/guilds";
  const session = await auth();
  if (session?.user?.id) redirect(next);

  async function signInWithDiscord() {
    "use server";
    await signIn("discord", { redirectTo: next });
  }

  return (
    <AuthCard mark={<Logo />} brand={false}>
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
      <p className="auth-foot">Your data stays on the machine TierZero runs on.</p>
    </AuthCard>
  );
}
