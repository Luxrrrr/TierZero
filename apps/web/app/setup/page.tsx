import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signIn, signOut } from "../../lib/auth";
import { claimInstanceOwnership, isInstanceClaimed } from "../../lib/instance";
import { AuthCard } from "../../components/AuthCard";
import { DiscordMark } from "../../components/Icons";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Set up",
};

// Whether the instance has been claimed is runtime state, so this page must
// never be prerendered: a build has no database to read it from.
export const dynamic = "force-dynamic";

/**
 * The first-run screen: who owns this install. Claiming is a button press, never
 * a side effect of opening the page, so a link preview, a prefetch or someone
 * else's browser cannot make itself the owner by loading it. Creating the
 * Discord application itself happens before this, by following the install
 * guide.
 */
export default async function SetupPage() {
  if (await isInstanceClaimed()) redirect("/login");

  const session = await auth();

  if (!session?.user?.id) {
    async function signInWithDiscord() {
      "use server";
      await signIn("discord", { redirectTo: "/setup" });
    }

    return (
      <AuthCard mark={<Logo />} brand={false}>
        <h1 className="auth-title">Set up TierZero</h1>
        <p className="auth-text">
          Nobody owns this installation yet. Sign in with the Discord account you
          want to run it with. After signing in you are asked to confirm, and that
          account becomes the owner.
        </p>
        <div className="auth-actions">
          <form action={signInWithDiscord}>
            <button type="submit" className="btn btn-discord btn-block">
              <DiscordMark />
              Continue with Discord
            </button>
          </form>
        </div>
        <p className="auth-foot">This screen is shown once, on a fresh install.</p>
      </AuthCard>
    );
  }

  const userId = session.user.id;

  async function claim() {
    "use server";
    // Checked again here: the page may have sat open while someone else claimed it.
    if (!(await isInstanceClaimed())) await claimInstanceOwnership(userId);
    redirect("/guilds");
  }

  async function switchAccount() {
    "use server";
    await signOut({ redirectTo: "/setup" });
  }

  return (
    <AuthCard mark={<Logo />} brand={false}>
      <h1 className="auth-title">Make this account the owner</h1>
      <p className="auth-text">
        You are signed in as <strong>{session.user.name ?? "this Discord account"}</strong>. The owner
        can use Moderation on every server TierZero is in, choose who else gets it, and install
        updates from the dashboard. An install has one owner.
      </p>
      <div className="auth-actions">
        <form action={claim}>
          <button type="submit" className="btn btn-primary btn-block">
            Make me the owner
          </button>
        </form>
        <form action={switchAccount}>
          <button type="submit" className="btn btn-ghost btn-block">
            Use a different Discord account
          </button>
        </form>
      </div>
      <p className="auth-foot">Pick the account you will keep. Changing the owner later is done in the install&apos;s .env file.</p>
    </AuthCard>
  );
}
