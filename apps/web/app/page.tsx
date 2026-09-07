import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { isInstanceClaimed } from "../lib/instance";

// Both branches depend on state Next can't see from the code path alone
// (instance-claim status, the caller's session), so without this it gets
// prerendered once at build time and every visitor is redirected wherever
// the build happened to land.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isInstanceClaimed())) {
    redirect("/setup");
  }

  const session = await auth();
  redirect(session?.user?.id ? "/guilds" : "/login");
}
