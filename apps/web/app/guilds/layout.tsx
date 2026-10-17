import type { ReactNode } from "react";
import { auth } from "../../lib/auth";
import { redirectIfUnclaimed, redirectToLogin } from "../../lib/auth-redirect";

// Every route under /guilds needs a signed-in user, so the check happens
// once here and no page below repeats it. The shell itself is rendered
// further down: the per-guild subtree needs the guild's modules to build
// its navigation, and a layout cannot see the segment below it.
export default async function GuildsLayout({ children }: { children: ReactNode }) {
  // The session is read first: it is what makes these pages render per request,
  // and the build must never try to read the database for them.
  const session = await auth();
  await redirectIfUnclaimed();
  if (!session?.user?.id) await redirectToLogin();

  return <>{children}</>;
}
