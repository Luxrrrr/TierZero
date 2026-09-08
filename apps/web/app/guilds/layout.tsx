import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "../../lib/auth";
import { AppShell } from "../../components/AppShell";

// Every route under /guilds needs a signed-in user, so the check happens
// once here rather than being repeated in each page.
export default async function GuildsLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell user={{ name: session.user.name, image: session.user.image }} signOutAction={signOutAction}>
      {children}
    </AppShell>
  );
}
