import Link from "next/link";
import { headers } from "next/headers";
import { AuthCard } from "../components/AuthCard";
import { AlertIcon } from "../components/Icons";
import { guildAccess } from "../lib/guild-access";
import { PATH_HEADER } from "../lib/login-redirect";
import { isTicketWorkspacePath } from "../lib/ticket-path";

/** Where someone refused this page can still go on the same server, if anywhere. */
async function elsewhere(): Promise<{ href: string; label: string } | null> {
  const path = (await headers()).get(PATH_HEADER) ?? "";
  const guildId = /^\/guilds\/(\d{17,20})(?:\/|$|\?)/.exec(path)?.[1];
  if (!guildId) return null;
  const access = await guildAccess(guildId).catch(() => null);
  if (!access?.ok) return null;
  if (access.staffRole && !path.startsWith(`/guilds/${guildId}/mod`)) {
    return { href: `/guilds/${guildId}/mod`, label: "Open Moderation on this server" };
  }
  if (access.ticketLevel && !path.startsWith(`/guilds/${guildId}/tickets`)) {
    return { href: `/guilds/${guildId}/tickets`, label: "Open Tickets on this server" };
  }
  return null;
}

export default async function Forbidden() {
  const other = await elsewhere();
  const path = (await headers()).get(PATH_HEADER) ?? "";
  const ticketPage = isTicketWorkspacePath(path);

  return (
    <AuthCard mark={<AlertIcon />} alert>
      <h1 className="auth-title">You do not have access to this page</h1>
      {ticketPage ? (
        <p className="auth-text">
          Tickets are open to the roles chosen as handlers for a ticket type in this server. None of
          your roles is one, so there is no ticket here for you to see. A member with Manage Server can
          add one of your roles as handlers in the Tickets settings.
        </p>
      ) : other ? (
        <p className="auth-text">
          This page changes the server&apos;s settings, which needs the Manage Server permission
          in Discord. You can still use the part of the dashboard you were given here.
        </p>
      ) : (
        <>
          <p className="auth-text">
            Changing a server&apos;s settings needs the Manage Server permission on it.
            That is a Discord permission, set on roles under Server Settings, and
            the server&apos;s owner always has it. The moderation tools need the owner
            of this installation to have added you as staff. The bot also has to be
            a member of the server.
          </p>
          <p className="auth-text">
            If you just invited the bot, go back to your servers and reload the
            page.
          </p>
        </>
      )}
      <div className="auth-actions">
        {other ? (
          <Link href={other.href} className="btn btn-primary btn-block">
            {other.label}
          </Link>
        ) : null}
        <Link href="/guilds" className="btn btn-secondary btn-block">
          Back to your servers
        </Link>
      </div>
    </AuthCard>
  );
}
