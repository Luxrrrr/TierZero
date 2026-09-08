import Link from "next/link";
import { AuthCard } from "../components/AuthCard";
import { AlertIcon } from "../components/Icons";

export default function Forbidden() {
  return (
    <AuthCard mark={<AlertIcon />} alert>
      <h1>You can&apos;t configure this server</h1>
      <p>
        You need the Manage Server permission on that Discord server, and the
        bot needs to already be a member of it. If you just added the bot,
        reload the guild list.
      </p>
      <Link href="/guilds" className="auth-back">
        Back to your servers
      </Link>
    </AuthCard>
  );
}
