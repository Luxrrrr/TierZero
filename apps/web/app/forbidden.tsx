import Link from "next/link";
import { AuthCard } from "../components/AuthCard";
import { AlertIcon } from "../components/Icons";

export default function Forbidden() {
  return (
    <AuthCard mark={<AlertIcon />} alert>
      <h1 className="auth-title">You do not have access to this page</h1>
      <p className="auth-text">
        Configuring a server needs the Manage Server permission on it, and the
        moderation tools need the owner of this installation to have added you
        as staff. The bot also has to be a member of the server.
      </p>
      <p className="auth-text">
        If you moderate this server, open Moderation from your list of servers.
        If you just invited the bot, go back to your servers and reload the
        page.
      </p>
      <div className="auth-actions">
        <Link href="/guilds" className="btn btn-secondary btn-block">
          Back to your servers
        </Link>
      </div>
    </AuthCard>
  );
}
