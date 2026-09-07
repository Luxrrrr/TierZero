import { redirect } from "next/navigation";
import { auth, signIn } from "../../lib/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/guilds");

  async function signInWithDiscord() {
    "use server";
    await signIn("discord", { redirectTo: "/guilds" });
  }

  return (
    <main>
      <h1>TierZero</h1>
      <p>Sign in with the Discord account you use to manage your server.</p>
      <form action={signInWithDiscord}>
        <button type="submit">Sign in with Discord</button>
      </form>
    </main>
  );
}
