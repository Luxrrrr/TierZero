import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signIn } from "../../lib/auth";
import { claimInstanceOwnership, isInstanceClaimed } from "../../lib/instance";
import { AuthCard } from "../../components/AuthCard";
import { DiscordMark } from "../../components/Icons";

export const metadata: Metadata = {
  title: "Set up",
};

// Whether the instance has been claimed is runtime state, so this page must
// never be prerendered: a build has no database to read it from.
export const dynamic = "force-dynamic";

// The minimal half of the setup wizard: claiming instance ownership. The
// guided walk-through for creating the Discord application itself (docs/
// architecture.md's "first-run wizard") is a separate, larger piece of work
// and isn't built here - this only covers the part task 3 asks for.
export default async function SetupPage() {
  if (await isInstanceClaimed()) redirect("/login");

  const session = await auth();

  if (!session?.user?.id) {
    async function signInWithDiscord() {
      "use server";
      await signIn("discord", { redirectTo: "/setup" });
    }

    return (
      <AuthCard mark="0">
        <h1>Set up TierZero</h1>
        <p>
          Nobody owns this installation yet. Sign in with the Discord account
          you want to manage it with — the first account to sign in here
          becomes the instance owner.
        </p>
        <form action={signInWithDiscord}>
          <button type="submit" className="btn btn-primary">
            <DiscordMark />
            Sign in with Discord
          </button>
        </form>
      </AuthCard>
    );
  }

  await claimInstanceOwnership(session.user.id);
  redirect("/guilds");
}
