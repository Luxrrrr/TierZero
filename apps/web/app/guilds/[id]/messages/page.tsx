import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { MessageLibrary } from "@tier0/core";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError, messagesRequest } from "../../../../lib/control-api";
import { botGuilds } from "../../../../lib/guild-data";
import { BotOffline } from "../../../../components/BotOffline";
import { MessagesStudio } from "../../../../components/messages/MessagesStudio";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const guilds = await botGuilds();
    const name = guilds.find((guild) => guild.id === id)?.name;
    return { title: name ? `Messages · ${name}` : "Messages" };
  } catch {
    return { title: "Messages" };
  }
}

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const reply = await messagesRequest(id, "");
    if (reply.status !== 200) throw new ControlApiError(reply.status, "The message library could not be loaded.");
    const library = reply.body as MessageLibrary;
    const guild = (await botGuilds()).find((candidate) => candidate.id === id);

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Server</p>
            <h1 className="page-title">Messages</h1>
            <p className="page-summary">
              Build a message or an embed, keep it as a template, and send it to any channel.
            </p>
          </div>
        </div>

        <MessagesStudio
          guildId={id}
          guildName={guild?.name ?? "your server"}
          memberCount={guild?.memberCount ?? 0}
          initial={library}
          botName="TierZero"
        />
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
