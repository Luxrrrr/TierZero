import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { isInstanceClaimed } from "../../lib/instance";
import { AuthCard } from "../../components/AuthCard";
import { Logo } from "../../components/Logo";

export const metadata: Metadata = {
  title: "Set up",
};

// Whether the instance has an owner is runtime state, so this page must never
// be prerendered: a build has no database to read it from.
export const dynamic = "force-dynamic";

/**
 * Shown while the install has no owner yet. Nobody claims it here: the bot
 * records the owner of its Discord application when it connects, or
 * INSTANCE_OWNER_ID names one. A screen anyone could press a button on would let
 * whoever reached a new install first take it.
 */
export default async function SetupPage() {
  if (await isInstanceClaimed()) redirect("/login");

  return (
    <AuthCard mark={<Logo />} brand={false}>
      <h1 className="auth-title">Waiting for the bot</h1>
      <p className="auth-text">
        The owner of this install is the Discord account that owns the bot&apos;s application in the
        Developer Portal. The bot reads that when it connects, so this page moves on to sign-in by itself
        once the bot is online.
      </p>
      <p className="auth-text">
        If it stays here, the bot isn&apos;t running or can&apos;t log in. Check that <code>DISCORD_TOKEN</code> in{" "}
        <code>.env</code> is right and look at the bot&apos;s log. You can also put your Discord user ID in{" "}
        <code>INSTANCE_OWNER_ID</code>.
      </p>
      <div className="auth-actions">
        <Link href="/setup" className="btn btn-primary btn-block">
          Check again
        </Link>
      </div>
    </AuthCard>
  );
}
