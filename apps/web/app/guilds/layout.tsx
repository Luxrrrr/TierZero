import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";

// Every route under /guilds needs a signed-in user, so the check happens
// once here and no page below repeats it. The shell itself is rendered
// further down: the per-guild subtree needs the guild's modules to build
// its navigation, and a layout cannot see the segment below it.
export default async function GuildsLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return <>{children}</>;
}
