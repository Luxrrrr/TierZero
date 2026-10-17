import { forbidden } from "next/navigation";
import type { Metadata } from "next";
import type { MessageLibrary } from "@tier0/core";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError, messagesRequest } from "../../../../lib/control-api";
import { botGuilds } from "../../../../lib/guild-data";
import { BotOffline } from "../../../../components/BotOffline";
import { MessagesStudio } from "../../../../components/messages/MessagesStudio";
import type { ScheduledSend } from "../../../../components/messages/SendDialog";
import { redirectToLogin } from "../../../../lib/auth-redirect";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const guilds = await botGuilds();
    const name = guilds.find((guild) => guild.id === id)?.name;
    return { title: name ? `Message creator · ${name}` : "Message creator" };
  } catch {
    return { title: "Message creator" };
  }
}

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  const { id } = await params;
  const requested = Number((await searchParams).template);

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) await redirectToLogin();
      forbidden();
    }

    const reply = await messagesRequest(id, "");
    if (reply.status !== 200) throw new ControlApiError(reply.status, "The message library could not be loaded.");
    const library = reply.body as MessageLibrary;
    // An older bot has no schedules to list, which is no reason to lose the page.
    const scheduled = await messagesRequest(id, "schedules").catch(() => null);
    const schedules = scheduled?.status === 200 && Array.isArray(scheduled.body) ? (scheduled.body as ScheduledSend[]) : [];
    const guild = (await botGuilds()).find((candidate) => candidate.id === id);

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Server</p>
            <h1 className="page-title">Message creator</h1>
            <p className="page-summary">
              Build a message or an embed, keep it as a template, and send it to any
              channel, now or later. A message TierZero sent can be replaced with a new
              version from here.
            </p>
          </div>
        </div>

        <MessagesStudio
          guildId={id}
          guildName={guild?.name ?? "your server"}
          memberCount={guild?.memberCount ?? 0}
          initial={library}
          schedules={schedules}
          initialTemplateId={Number.isInteger(requested) && requested > 0 ? requested : null}
          botName="TierZero"
        />
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
